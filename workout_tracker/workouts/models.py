from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.auth.models import User


class Workout_Split(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=200, verbose_name="Routine Name:")
    
    def __str__(self):
        return self.name
    

class Workouts(models.Model):
    split = models.ForeignKey(Workout_Split, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=256)
    
    def __str__(self):
        return self.name
    
class Exercises(models.Model):
    name = models.CharField(max_length=100)
