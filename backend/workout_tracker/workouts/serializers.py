from rest_framework import serializers

from .models import WorkoutSession, WorkoutSet, WorkoutSplit


class WorkoutSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkoutSet
        fields = ("id", "weight", "reps")
        read_only_fields = ("id",)


class WorkoutSessionSerializer(serializers.ModelSerializer):
    sets = WorkoutSetSerializer(many=True, read_only=True)
    max_weight = serializers.FloatField(read_only=True)

    class Meta:
        model = WorkoutSession
        fields = ("id", "date", "sets", "max_weight")
        read_only_fields = fields


class WorkoutSplitSerializer(serializers.ModelSerializer):
    sessions = WorkoutSessionSerializer(many=True, read_only=True)

    class Meta:
        model = WorkoutSplit
        fields = ("id", "name", "created_at", "sessions")
        read_only_fields = ("id", "created_at", "sessions")


class WorkoutSplitListSerializer(serializers.ModelSerializer):
    """Lightweight version (no nested sessions) for index pages."""

    session_count = serializers.IntegerField(read_only=True)
    best_max_weight = serializers.FloatField(read_only=True)
    last_session_date = serializers.DateTimeField(read_only=True)

    class Meta:
        model = WorkoutSplit
        fields = (
            "id",
            "name",
            "created_at",
            "session_count",
            "best_max_weight",
            "last_session_date",
        )


class CalculatorSerializer(serializers.Serializer):
    weight = serializers.FloatField(min_value=0.1)
    reps = serializers.IntegerField(min_value=1, max_value=30)
