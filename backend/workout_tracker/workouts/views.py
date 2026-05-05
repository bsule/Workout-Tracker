import csv
import io
import json
from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Exercise, Workout, WorkoutExercise, WorkoutSet
from .prs import recompute_prs
from .serializers import (
    CalculatorSerializer,
    ExerciseSerializer,
    WorkoutExerciseSerializer,
    WorkoutSerializer,
    WorkoutSetSerializer,
)


# ---------- ownership helpers ----------

def _get_owned_workout(user, pk) -> Workout:
    w = Workout.objects.filter(pk=pk).first()
    if w is None:
        raise NotFound("Workout not found.")
    if w.user_id != user.id:
        raise PermissionDenied("You do not own this workout.")
    return w


def _get_owned_workout_exercise(user, pk) -> WorkoutExercise:
    we = WorkoutExercise.objects.select_related("workout", "exercise").filter(pk=pk).first()
    if we is None:
        raise NotFound("Exercise entry not found.")
    if we.workout.user_id != user.id:
        raise PermissionDenied("You do not own this exercise entry.")
    return we


def _get_owned_set(user, pk) -> WorkoutSet:
    s = WorkoutSet.objects.select_related(
        "workout_exercise__workout", "workout_exercise__exercise"
    ).filter(pk=pk).first()
    if s is None:
        raise NotFound("Set not found.")
    if s.workout_exercise.workout.user_id != user.id:
        raise PermissionDenied("You do not own this set.")
    return s


def _get_visible_exercise(user, pk) -> Exercise:
    """An Exercise is visible if it is global (user is null) or owned by the user."""
    e = Exercise.objects.filter(pk=pk).filter(Q(user__isnull=True) | Q(user=user)).first()
    if e is None:
        raise NotFound("Exercise not found.")
    return e


def _annotated_exercises(user):
    today = timezone.now().date()
    qs = (
        Exercise.objects.filter(Q(user__isnull=True) | Q(user=user))
        .annotate(
            workouts_count=Count(
                "workoutexercise",
                filter=Q(workoutexercise__workout__user=user),
                distinct=True,
            ),
            last_date=Max(
                "workoutexercise__workout__date",
                filter=Q(workoutexercise__workout__user=user),
            ),
        )
    )
    # Attach last_performed_days_ago in Python because we need a date diff.
    # Avoid touching the DB extra; we set the attribute used by the serializer.
    results = list(qs)
    for ex in results:
        last = getattr(ex, "last_date", None)
        ex.last_performed_days_ago = (today - last).days if last else None
    return results


# ---------- exercises ----------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def exercise_list_create(request):
    if request.method == "POST":
        name = (request.data.get("name") or "").strip()
        category = (request.data.get("category") or "").strip()
        if not name:
            raise ValidationError({"name": "Required."})
        if category not in dict(Exercise.CATEGORY_CHOICES):
            raise ValidationError({"category": "Invalid category."})
        # Disallow exact duplicate name within user's visible scope.
        if Exercise.objects.filter(
            Q(user__isnull=True) | Q(user=request.user), name__iexact=name
        ).exists():
            raise ValidationError({"name": "An exercise with that name already exists."})
        ex = Exercise.objects.create(
            name=name, category=category, is_custom=True, user=request.user
        )
        return Response(ExerciseSerializer(ex).data, status=status.HTTP_201_CREATED)

    # GET
    exercises = _annotated_exercises(request.user)

    category = request.query_params.get("category")
    if category:
        exercises = [e for e in exercises if e.category == category]

    q = (request.query_params.get("q") or "").strip().lower()
    if q:
        exercises = [e for e in exercises if q in e.name.lower()]

    sort = request.query_params.get("sort")
    if sort == "last_performed":
        # Most recent first; never-performed last.
        exercises.sort(
            key=lambda e: (
                e.last_performed_days_ago if e.last_performed_days_ago is not None else 10**9,
                e.name.lower(),
            )
        )
    else:
        exercises.sort(key=lambda e: e.name.lower())

    return Response(ExerciseSerializer(exercises, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def exercise_history(request, pk):
    """Return the user's history for one exercise: list of {date, sets[]} ordered by date asc."""
    _get_visible_exercise(request.user, pk)
    rows = (
        WorkoutSet.objects
        .filter(
            workout_exercise__exercise_id=pk,
            workout_exercise__workout__user=request.user,
        )
        .select_related("workout_exercise__workout")
        .order_by("workout_exercise__workout__date", "order", "id")
    )
    by_date: dict[str, list[dict]] = {}
    for s in rows:
        date_iso = s.workout_exercise.workout.date.isoformat()
        by_date.setdefault(date_iso, []).append(
            {
                "id": s.id,
                "weight": s.weight,
                "reps": s.reps,
                "is_pr": s.is_pr,
                "was_pr": s.was_pr,
                "note": s.note,
                "order": s.order,
                "estimated_one_rm": round(s.estimated_one_rm(), 1),
            }
        )
    out = [{"date": d, "sets": s} for d, s in sorted(by_date.items())]
    return Response(out)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def exercise_delete(request, pk):
    ex = Exercise.objects.filter(pk=pk).first()
    if ex is None:
        raise NotFound("Exercise not found.")
    if not ex.is_custom or ex.user_id != request.user.id:
        raise PermissionDenied("Only your custom exercises can be deleted.")
    if WorkoutExercise.objects.filter(exercise=ex).exists():
        raise ValidationError({"detail": "This exercise is used in workouts and cannot be deleted."})
    ex.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- workouts ----------

def _parse_iso_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ValidationError({"date": "Expected YYYY-MM-DD."})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def workout_list_create(request):
    if request.method == "POST":
        d = _parse_iso_date(request.data.get("date") or "")
        try:
            workout, _created = Workout.objects.get_or_create(
                user=request.user,
                date=d,
                defaults={"started_at": timezone.now()},
            )
        except IntegrityError:
            workout = Workout.objects.get(user=request.user, date=d)
        return Response(
            WorkoutSerializer(workout).data,
            status=status.HTTP_200_OK,
        )

    # GET
    qs = Workout.objects.filter(user=request.user).prefetch_related(
        "exercises__exercise", "exercises__sets"
    )
    date_param = request.query_params.get("date")
    month_param = request.query_params.get("month")
    if date_param:
        qs = qs.filter(date=_parse_iso_date(date_param))
    elif month_param:
        try:
            year, month = month_param.split("-")
            qs = qs.filter(date__year=int(year), date__month=int(month))
        except (ValueError, AttributeError):
            raise ValidationError({"month": "Expected YYYY-MM."})
    return Response(WorkoutSerializer(qs, many=True).data)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def workout_detail(request, pk):
    workout = _get_owned_workout(request.user, pk)
    if request.method == "DELETE":
        workout.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "PATCH":
        for field in ("notes", "started_at", "finished_at"):
            if field in request.data:
                setattr(workout, field, request.data[field])
        workout.save()
    return Response(WorkoutSerializer(workout).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def workout_by_date(request, iso_date):
    d = _parse_iso_date(iso_date)
    workout = Workout.objects.filter(user=request.user, date=d).first()
    if workout is None:
        raise NotFound("No workout for that date.")
    return Response(WorkoutSerializer(workout).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def workout_add_exercise(request, pk):
    workout = _get_owned_workout(request.user, pk)
    exercise_id = request.data.get("exercise_id")
    if not exercise_id:
        raise ValidationError({"exercise_id": "Required."})
    exercise = _get_visible_exercise(request.user, exercise_id)
    # If already on the workout, return existing.
    existing = WorkoutExercise.objects.filter(workout=workout, exercise=exercise).first()
    if existing:
        return Response(WorkoutExerciseSerializer(existing).data, status=status.HTTP_200_OK)
    next_order = WorkoutExercise.objects.filter(workout=workout).count()
    we = WorkoutExercise.objects.create(workout=workout, exercise=exercise, order=next_order)
    return Response(WorkoutExerciseSerializer(we).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def workout_remove_exercise(request, pk, we_id):
    workout = _get_owned_workout(request.user, pk)
    we = WorkoutExercise.objects.filter(workout=workout, pk=we_id).first()
    if we is None:
        raise NotFound("Exercise entry not found on this workout.")
    exercise_id = we.exercise_id
    we.delete()
    recompute_prs(request.user, exercise_id)
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- sets ----------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def workout_exercise_add_set(request, we_id):
    we = _get_owned_workout_exercise(request.user, we_id)
    serializer = WorkoutSetSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    weight = serializer.validated_data["weight"]
    reps = serializer.validated_data["reps"]
    note = serializer.validated_data.get("note", "")
    next_order = WorkoutSet.objects.filter(workout_exercise=we).count()
    s = WorkoutSet.objects.create(
        workout_exercise=we, weight=weight, reps=reps, note=note, order=next_order
    )
    recompute_prs(request.user, we.exercise_id)
    s.refresh_from_db()
    return Response(WorkoutSetSerializer(s).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def set_detail(request, pk):
    s = _get_owned_set(request.user, pk)
    exercise_id = s.workout_exercise.exercise_id
    if request.method == "DELETE":
        s.delete()
        recompute_prs(request.user, exercise_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
    # PATCH
    if "weight" in request.data:
        s.weight = float(request.data["weight"])
    if "reps" in request.data:
        s.reps = int(request.data["reps"])
    if "note" in request.data:
        s.note = (request.data.get("note") or "")[:2000]
    s.save()
    recompute_prs(request.user, exercise_id)
    s.refresh_from_db()
    return Response(WorkoutSetSerializer(s).data)


# ---------- copy ----------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def workout_copy_from(request, pk, source_id):
    target = _get_owned_workout(request.user, pk)
    source = _get_owned_workout(request.user, source_id)
    with_sets = request.query_params.get("with_sets") == "1"
    touched_exercise_ids = set()
    with transaction.atomic():
        existing_exercise_ids = set(
            WorkoutExercise.objects.filter(workout=target).values_list("exercise_id", flat=True)
        )
        next_order = WorkoutExercise.objects.filter(workout=target).count()
        for src_we in source.exercises.all().order_by("order", "id"):
            if src_we.exercise_id in existing_exercise_ids:
                continue
            new_we = WorkoutExercise.objects.create(
                workout=target,
                exercise=src_we.exercise,
                order=next_order,
            )
            next_order += 1
            if with_sets:
                for src_set in src_we.sets.all().order_by("order", "id"):
                    WorkoutSet.objects.create(
                        workout_exercise=new_we,
                        weight=src_set.weight,
                        reps=src_set.reps,
                        order=src_set.order,
                    )
                touched_exercise_ids.add(src_we.exercise_id)
    for ex_id in touched_exercise_ids:
        recompute_prs(request.user, ex_id)
    target.refresh_from_db()
    return Response(WorkoutSerializer(target).data)


# ---------- calendar ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def calendar_view(request):
    try:
        year = int(request.query_params.get("year"))
        month = int(request.query_params.get("month"))
    except (TypeError, ValueError):
        raise ValidationError({"detail": "year and month query params required."})

    rows = (
        WorkoutExercise.objects
        .filter(
            workout__user=request.user,
            workout__date__year=year,
            workout__date__month=month,
        )
        .values("workout__date", "exercise__category")
        .distinct()
    )
    out: dict[str, list[str]] = {}
    for r in rows:
        key = r["workout__date"].isoformat()
        cat = r["exercise__category"]
        out.setdefault(key, [])
        if cat not in out[key]:
            out[key].append(cat)
    # Also include workouts that exist but have no exercises yet (so user sees a marker).
    empty = (
        Workout.objects.filter(user=request.user, date__year=year, date__month=month)
        .exclude(exercises__isnull=False)
        .values_list("date", flat=True)
        .distinct()
    )
    for d in empty:
        out.setdefault(d.isoformat(), [])
    return Response(out)


# ---------- CSV import ----------

DATE_FORMATS = [
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%m/%d/%Y",
    "%d/%m/%Y",
    "%m-%d-%Y",
    "%d-%m-%Y",
    "%Y-%m-%d %H:%M:%S",
    "%m/%d/%Y %H:%M",
]


def _read_csv(file_obj):
    raw = file_obj.read()
    if isinstance(raw, bytes):
        # utf-8-sig strips BOM if present
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        text = raw
    return list(csv.DictReader(io.StringIO(text)))


def _infer_date_format(sample: str):
    sample = (sample or "").strip()
    if not sample:
        return None
    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(sample, fmt)
            return fmt
        except ValueError:
            continue
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def csv_preview(request):
    f = request.FILES.get("file")
    if f is None:
        raise ValidationError({"file": "Required."})
    rows = _read_csv(f)
    headers = list(rows[0].keys()) if rows else []
    sample_rows = rows[:10]
    inferred = None
    for h in headers:
        if "date" in h.lower():
            for r in rows:
                fmt = _infer_date_format(r.get(h, ""))
                if fmt:
                    inferred = fmt
                    break
            if inferred:
                break
    return Response(
        {
            "headers": headers,
            "rows": sample_rows,
            "row_count": len(rows),
            "inferred_date_format": inferred,
        }
    )


def _parse_float(s):
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    # Strip trailing units like "lb", "kg".
    cleaned = ""
    for ch in s:
        if ch.isdigit() or ch in ".-":
            cleaned += ch
        else:
            break
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_int(s):
    f = _parse_float(s)
    if f is None:
        return None
    try:
        return int(f)
    except (TypeError, ValueError):
        return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def csv_import(request):
    f = request.FILES.get("file")
    if f is None:
        raise ValidationError({"file": "Required."})
    mapping_raw = request.data.get("mapping")
    if not mapping_raw:
        raise ValidationError({"mapping": "Required."})
    try:
        mapping = json.loads(mapping_raw) if isinstance(mapping_raw, str) else dict(mapping_raw)
    except json.JSONDecodeError:
        raise ValidationError({"mapping": "Invalid JSON."})

    required = ("date_col", "exercise_col", "weight_col", "reps_col")
    for k in required:
        if not mapping.get(k):
            raise ValidationError({k: "Required in mapping."})

    date_fmt = mapping.get("date_format") or "%Y-%m-%d"
    default_category = mapping.get("default_category") or "chest"
    if default_category not in dict(Exercise.CATEGORY_CHOICES):
        default_category = "chest"

    rows = _read_csv(f)

    imported = 0
    errors = []
    created_exercise_names: set[str] = set()
    touched: set[tuple[int, int]] = set()  # (user_id, exercise_id)

    with transaction.atomic():
        for idx, row in enumerate(rows, start=2):  # account for header line
            try:
                date_raw = (row.get(mapping["date_col"]) or "").strip()
                ex_name = (row.get(mapping["exercise_col"]) or "").strip()
                weight = _parse_float(row.get(mapping["weight_col"]))
                reps = _parse_int(row.get(mapping["reps_col"]))
                if not date_raw or not ex_name or weight is None or reps is None or reps <= 0:
                    errors.append({"row": idx, "message": "Missing or invalid date/exercise/weight/reps."})
                    continue
                try:
                    d = datetime.strptime(date_raw, date_fmt).date()
                except ValueError:
                    errors.append({"row": idx, "message": f"Bad date '{date_raw}' for format '{date_fmt}'."})
                    continue

                # Find exercise (prefer global, then user's custom).
                exercise = (
                    Exercise.objects.filter(name__iexact=ex_name, user__isnull=True).first()
                    or Exercise.objects.filter(name__iexact=ex_name, user=request.user).first()
                )
                if exercise is None:
                    cat = default_category
                    cat_col = mapping.get("category_col")
                    if cat_col:
                        raw_cat = (row.get(cat_col) or "").strip().lower()
                        if raw_cat in dict(Exercise.CATEGORY_CHOICES):
                            cat = raw_cat
                    exercise = Exercise.objects.create(
                        name=ex_name, category=cat, is_custom=True, user=request.user
                    )
                    created_exercise_names.add(exercise.name)

                workout, _ = Workout.objects.get_or_create(user=request.user, date=d)
                we, _created_we = WorkoutExercise.objects.get_or_create(
                    workout=workout,
                    exercise=exercise,
                    defaults={"order": WorkoutExercise.objects.filter(workout=workout).count()},
                )
                next_order = WorkoutSet.objects.filter(workout_exercise=we).count()
                WorkoutSet.objects.create(
                    workout_exercise=we,
                    weight=weight,
                    reps=reps,
                    order=next_order,
                )
                touched.add((request.user.id, exercise.id))
                imported += 1
            except Exception as exc:  # noqa: BLE001 — surface unexpected per-row issues
                errors.append({"row": idx, "message": str(exc)})

    for _user_id, exercise_id in touched:
        recompute_prs(request.user, exercise_id)

    return Response(
        {
            "imported": imported,
            "exercises_created": sorted(created_exercise_names),
            "errors": errors,
        }
    )


# ---------- calculator (kept) ----------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def calculator_view(request):
    serializer = CalculatorSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    weight = serializer.validated_data["weight"]
    reps = serializer.validated_data["reps"]
    one_rep_max = weight if reps == 1 else weight / (1.0278 - 0.0278 * reps)
    return Response({"one_rep_max": round(one_rep_max, 1)})
