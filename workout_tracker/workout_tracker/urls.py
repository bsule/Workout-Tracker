from django.contrib import admin
from django.urls import path, include
from . import views
from .views import *
from django.views.generic import TemplateView

urlpatterns = [
    path('', views.home_view, name='home'),
    path('registration/', include('accounts.urls'), name='registration'),
    path('', include('workouts.urls')),
    path('about/', views.about_view, name='about_view'),
    path('admin/', admin.site.urls),
]
