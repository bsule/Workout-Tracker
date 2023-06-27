from django.contrib import admin
from django.urls import path, include
from . import views
from .views import *


urlpatterns = [
    path('workouts/', views.workout_chooser, name='workout_choose'),
    path('workouts/list/', views.workoutsplitshowerview, name='workoutsplitshowerview'),
    path('workouts/list/<int:pk>/', views.reps_view, name='reps_view'),
    path('calculator/', views.calculator_view, name='calculator_view'),
    path('delete/',views.delete_view, name='delete_view'),
]
