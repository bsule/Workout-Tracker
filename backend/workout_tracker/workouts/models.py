from django.contrib.auth.models import User
from django.db import models


class WorkoutSplit(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="workout_splits"
    )
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class WorkoutSession(models.Model):
    split = models.ForeignKey(
        WorkoutSplit, on_delete=models.CASCADE, related_name="sessions"
    )
    date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date"]

    @property
    def max_weight(self) -> float:
        best = 0.0
        for s in self.sets.all():
            if s.reps == 1:
                est = float(s.weight)
            else:
                est = s.weight / (1.0278 - 0.0278 * s.reps)
            if est > best:
                best = est
        return round(best, 1)

    def __str__(self):
        return f"{self.split.name} @ {self.date.isoformat()}"


class WorkoutSet(models.Model):
    session = models.ForeignKey(
        WorkoutSession, on_delete=models.CASCADE, related_name="sets"
    )
    weight = models.FloatField()
    reps = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
