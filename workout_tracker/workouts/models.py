from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.auth.models import User


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

class Workout(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True)
    split = models.ForeignKey(Workout_Split, on_delete=models.CASCADE)
    name = models.OneToOneField(Exercise, on_delete=models.CASCADE, null=True)
    reps = models.TextField()
    
    def __str__(self):
        return self.name.name
    

