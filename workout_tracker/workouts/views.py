from django.shortcuts import render
from .forms import Workout_SplitForm
from .models import Workout_Split

# Create your views here.

def workout_chooser(request):
    form = Workout_SplitForm(request.POST or None)

    if form.is_valid(): # adds user to the workout
        form.instance.user = request.user
        workout = form.save(commit=False)
        workout.user = request.user
        workout.save()

    context = {}
    context['form'] = form
    return render(request, 'workout_chooser.html', context)

def workoutsplitshowerview(request):
    workoutsplit = Workout_Split.objects.filter(user=request.user)
    return render(request, 'workoutsplitshower.html',{'workoutsplit':workoutsplit})