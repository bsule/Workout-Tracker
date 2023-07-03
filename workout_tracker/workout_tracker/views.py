from django.views.generic import TemplateView
from django.urls import reverse_lazy
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from workouts.models import *

    
def home_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    return render(request, 'index.html')

@login_required
def about_view(request):
    return render(request, 'about.html')