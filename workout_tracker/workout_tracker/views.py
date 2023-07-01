from django.views.generic import TemplateView
from django.urls import reverse_lazy
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from workouts.models import *

    
def home_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    hold = Workout_Split.objects.get(id=22)
    hold2 = Weight_and_reps.objects.filter(model=hold)[::-1]   # negative indexing not supported so 
    hold2 = hold2[:7]                                          # flip the list and get the last 7 
    hold2 = hold2[::-1]                                        # then flip back
    
    context = {}
    context['data'] = hold2
    context['name'] = hold.name
    return render(request, 'index.html', context)

@login_required
def about_view(request):
    return render(request, 'about.html')