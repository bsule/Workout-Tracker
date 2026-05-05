from django.contrib import admin

from .models import Exercise, Workout, WorkoutExercise, WorkoutSet

admin.site.register(Exercise)
admin.site.register(Workout)
admin.site.register(WorkoutExercise)
admin.site.register(WorkoutSet)
