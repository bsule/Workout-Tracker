from django.contrib import admin

from .models import WorkoutSession, WorkoutSet, WorkoutSplit

admin.site.register(WorkoutSplit)
admin.site.register(WorkoutSession)
admin.site.register(WorkoutSet)
