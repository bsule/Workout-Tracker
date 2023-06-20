from django.contrib import admin
from django.urls import path, include
from . import views
from .views import *


urlpatterns = [
    path('', views.workout_chooser, name='workout_choose'),
    path('list/', views.workoutsplitshowerview, name='workoutsplitshowerview'),
    path('list/<int:pk>/', views.reps_view, name='reps_view'),
]
