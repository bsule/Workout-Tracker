from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.auth.models import User
from datetime import datetime


class Workout_Split(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=200, verbose_name="Routine Name:")
    id = models.AutoField(primary_key=True)
    
    def __str__(self):
        return self.name
    
class Exercise(models.Model):
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name
    
class Weight_and_reps(models.Model):
    model = models.ForeignKey(Workout_Split, on_delete=models.CASCADE)
    weight = models.TextField(null=True, blank=True, default="")
    reps = models.TextField(null=True, blank=True, default="")
    date = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return self.model.name
    