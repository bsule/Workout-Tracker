from django.shortcuts import render, redirect, get_object_or_404
from .forms import *
from .models import Workout_Split
from django.http import HttpResponseForbidden

# Create your views here.

def workout_chooser(request):
    form = Workout_SplitForm(request.POST or None)

    if form.is_valid(): # adds user to the workout
        form.instance.user = request.user
        workout = form.save(commit=False)
        workout.user = request.user
        workout.save()
        return redirect('workoutsplitshowerview')

    context = {}
    context['form'] = form
    return render(request, 'workout_chooser.html', context)

def workoutsplitshowerview(request):
    workoutsplit = Workout_Split.objects.filter(user=request.user)
    return render(request, 'workoutsplitshower.html',{'workoutsplit':workoutsplit})

def reps_view(request, pk):
    my_model = get_object_or_404(Workout_Split, pk=pk)
    if my_model.user != request.user:
        return HttpResponseForbidden("You are not allowed to access this page.")
    
    form = Weight_and_reps(request.POST)

    if form.is_valid():
        weight = form.cleaned_data['weight']
        reps = form.cleaned_data['reps']
        my_model.reps += (str(weight) + " " + str(reps))
        my_model.save()
        
    
    workoutsplit = Workout_Split.objects.get(id=pk)
    context = {}
    context['form'] = form
    context['workoutsplit'] = workoutsplit
    return render(request, 'replist.html', context)