from django.contrib import admin
from django.urls import path, include
from . import views
from .views import HomePage
from django.views.generic import TemplateView

urlpatterns = [
    path('', views.HomePage.as_view(), name='home'),
    path('registration/', include('accounts.urls'), name='registration'),
    path('workouts/', include('workouts.urls')),
    path('admin/', admin.site.urls),
]
