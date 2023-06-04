from django.contrib import admin
from django.urls import path, include
from . import views
from .views import workout_chooser, workoutsplitshowerview


urlpatterns = [
    path('', views.workout_chooser, name='workout_choose'),
    path('viewer', views.workoutsplitshowerview, name='workoutsplitshowerview')
]
