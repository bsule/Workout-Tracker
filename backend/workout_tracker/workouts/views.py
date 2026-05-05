from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import WorkoutSession, WorkoutSet, WorkoutSplit
from .serializers import (
    CalculatorSerializer,
    WorkoutSessionSerializer,
    WorkoutSetSerializer,
    WorkoutSplitSerializer,
)


class WorkoutSplitListCreateView(generics.ListCreateAPIView):
    serializer_class = WorkoutSplitSerializer

    def get_queryset(self):
        return (
            WorkoutSplit.objects.filter(user=self.request.user)
            .prefetch_related("sessions__sets")
            .order_by("-created_at")
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class WorkoutSplitDetailView(generics.RetrieveDestroyAPIView):
    serializer_class = WorkoutSplitSerializer

    def get_queryset(self):
        return WorkoutSplit.objects.filter(
            user=self.request.user
        ).prefetch_related("sessions__sets")


def _get_owned_split(user, pk) -> WorkoutSplit:
    split = WorkoutSplit.objects.filter(pk=pk).first()
    if split is None:
        raise PermissionDenied("Workout not found.")
    if split.user_id != user.id:
        raise PermissionDenied("You do not own this workout.")
    return split


def _get_owned_session(user, pk) -> WorkoutSession:
    session = WorkoutSession.objects.select_related("split").filter(pk=pk).first()
    if session is None:
        raise PermissionDenied("Session not found.")
    if session.split.user_id != user.id:
        raise PermissionDenied("You do not own this session.")
    return session


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_session_view(request, split_id):
    split = _get_owned_split(request.user, split_id)
    session = WorkoutSession.objects.create(split=split)
    return Response(
        WorkoutSessionSerializer(session).data, status=status.HTTP_201_CREATED
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_session_view(request, session_id):
    session = _get_owned_session(request.user, session_id)
    session.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_set_view(request, session_id):
    session = _get_owned_session(request.user, session_id)
    serializer = WorkoutSetSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    workout_set = WorkoutSet.objects.create(session=session, **serializer.validated_data)
    return Response(
        WorkoutSetSerializer(workout_set).data, status=status.HTTP_201_CREATED
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def calculator_view(request):
    serializer = CalculatorSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    weight = serializer.validated_data["weight"]
    reps = serializer.validated_data["reps"]
    one_rep_max = weight if reps == 1 else weight / (1.0278 - 0.0278 * reps)
    return Response({"one_rep_max": round(one_rep_max, 1)})
