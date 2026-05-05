from django.contrib.auth.models import User
from django.db import models


class Exercise(models.Model):
    CATEGORY_CHOICES = [
        ("abs", "Abs"),
        ("back", "Back"),
        ("biceps", "Biceps"),
        ("cardio", "Cardio"),
        ("chest", "Chest"),
        ("legs", "Legs"),
        ("shoulders", "Shoulders"),
        ("triceps", "Triceps"),
    ]

    name = models.CharField(max_length=120)
    category = models.CharField(max_length=16, choices=CATEGORY_CHOICES)
    is_custom = models.BooleanField(default=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="custom_exercises",
    )

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"], name="unique_exercise_per_user"
            ),
        ]

    def __str__(self):
        scope = "global" if self.user_id is None else f"user:{self.user_id}"
        return f"{self.name} ({self.category}, {scope})"


class Workout(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="workouts"
    )
    date = models.DateField()
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "date"], name="unique_workout_per_user_date"
            ),
        ]

    @property
    def duration_seconds(self):
        if self.started_at and self.finished_at:
            return int((self.finished_at - self.started_at).total_seconds())
        return None

    def __str__(self):
        return f"{self.user.username} {self.date.isoformat()}"


class WorkoutExercise(models.Model):
    workout = models.ForeignKey(
        Workout, on_delete=models.CASCADE, related_name="exercises"
    )
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.workout} :: {self.exercise.name}"


class WorkoutSet(models.Model):
    workout_exercise = models.ForeignKey(
        WorkoutExercise, on_delete=models.CASCADE, related_name="sets"
    )
    weight = models.FloatField()
    reps = models.PositiveIntegerField()
    is_pr = models.BooleanField(default=False)
    was_pr = models.BooleanField(default=False)
    note = models.TextField(blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def estimated_one_rm(self) -> float:
        if self.reps <= 0:
            return 0.0
        if self.reps == 1:
            return float(self.weight)
        return float(self.weight) / (1.0278 - 0.0278 * self.reps)
