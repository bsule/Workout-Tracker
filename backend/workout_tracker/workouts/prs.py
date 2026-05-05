from .models import WorkoutSet


def recompute_prs(user, exercise_id: int) -> None:
    """Recompute is_pr / was_pr for every WorkoutSet of (user, exercise_id).

    Dominance rule for PRs. Set A is dominated by set B when ANY of:
      (a) B's weight is strictly heavier AND B's reps are <= A's reps.
          (heavier at fewer-or-equal reps wipes the lighter set)
      (b) B's weight equals A's weight AND B's reps are strictly more.
          (more reps at the same weight wipes the lower-rep set)
      (c) Same (weight, reps) but B was logged earlier (lower id).
          (tie-breaker: earliest occurrence keeps the star)

    A set is a PR iff no other set dominates it. was_pr is sticky:
    once a set has been a PR, the flag stays True even if dethroned later.

    Examples:
      - 60x8 + 60x7   -> only 60x8 PR  (b)
      - 100x7 + 90x8  -> only 100x7 PR (a)
      - Two 55x8 sets -> only the earlier one PR (c)
      - 100x1 + 100x5 -> only 100x5 PR (b)
    """
    sets = list(
        WorkoutSet.objects.filter(
            workout_exercise__exercise_id=exercise_id,
            workout_exercise__workout__user=user,
        ).order_by("id")
    )
    if not sets:
        return

    pr_ids: set[int] = set()
    for s in sets:
        dominated = False
        for o in sets:
            if o.id == s.id:
                continue
            if o.weight > s.weight and o.reps <= s.reps:
                dominated = True
                break
            if o.weight == s.weight and o.reps > s.reps:
                dominated = True
                break
            if (
                o.weight == s.weight
                and o.reps == s.reps
                and o.id < s.id
            ):
                dominated = True
                break
        if not dominated:
            pr_ids.add(s.id)

    to_set_pr = []
    to_clear_pr = []
    to_set_was_pr = []
    for s in sets:
        should_be = s.id in pr_ids
        if should_be and not s.is_pr:
            to_set_pr.append(s.id)
        elif not should_be and s.is_pr:
            to_clear_pr.append(s.id)
        if should_be and not s.was_pr:
            to_set_was_pr.append(s.id)

    if to_set_pr:
        WorkoutSet.objects.filter(id__in=to_set_pr).update(is_pr=True)
    if to_clear_pr:
        WorkoutSet.objects.filter(id__in=to_clear_pr).update(is_pr=False)
    if to_set_was_pr:
        WorkoutSet.objects.filter(id__in=to_set_was_pr).update(was_pr=True)
