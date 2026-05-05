from rest_framework import serializers

from .models import Exercise, Workout, WorkoutExercise, WorkoutSet


class ExerciseSerializer(serializers.ModelSerializer):
    workouts_count = serializers.IntegerField(read_only=True, required=False)
    last_performed_days_ago = serializers.IntegerField(
        read_only=True, required=False, allow_null=True
    )

    class Meta:
        model = Exercise
        fields = (
            "id",
            "name",
            "category",
            "is_custom",
            "workouts_count",
            "last_performed_days_ago",
        )
        read_only_fields = ("id", "is_custom", "workouts_count", "last_performed_days_ago")


class WorkoutSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkoutSet
        fields = ("id", "weight", "reps", "is_pr", "was_pr", "note", "order")
        read_only_fields = ("id", "is_pr", "was_pr")


class WorkoutExerciseSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    sets = WorkoutSetSerializer(many=True, read_only=True)

    class Meta:
        model = WorkoutExercise
        fields = ("id", "exercise", "order", "sets")
        read_only_fields = fields


class WorkoutSerializer(serializers.ModelSerializer):
    exercises = WorkoutExerciseSerializer(many=True, read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = Workout
        fields = (
            "id",
            "date",
            "started_at",
            "finished_at",
            "duration_seconds",
            "notes",
            "exercises",
            "created_at",
        )
        read_only_fields = ("id", "duration_seconds", "exercises", "created_at")


class CalculatorSerializer(serializers.Serializer):
    weight = serializers.FloatField(min_value=0.1)
    reps = serializers.IntegerField(min_value=1, max_value=30)
