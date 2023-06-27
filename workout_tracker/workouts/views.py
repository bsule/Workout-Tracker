from django.shortcuts import render, redirect, get_object_or_404, reverse
from .forms import *
from .models import Workout_Split, Weight_and_reps
from django.http import HttpResponseForbidden
from django.contrib.auth.decorators import login_required

# Create your views here.

@login_required
def delete_view(request):
    models = Workout_Split.objects.filter(user=request.user)
    if request.method == 'POST':
        workout_id = request.POST.get('deleted_workout')
        model = Workout_Split.objects.get(id=workout_id)
        
        model.delete()
        return redirect('workoutsplitshowerview')

    content = {}
    content['models'] = models
    return render(request,'delete_workout.html', content)


@login_required
def calculator_view(request):
    form = Max_Rep_Calculator_Form(request.POST)
    onerep=-1
    
    if request.method == 'POST' and form.is_valid():
        weight = form.cleaned_data.get('weight')
        reps = form.cleaned_data.get('reps')
        onerep = weight/(1.0278-(.0278*reps))
    
    onerep = onerep
    content = {}
    content['form'] = form
    content['onerep'] = round(onerep, 1)
    return render(request, 'calculator.html', content)


@login_required
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


@login_required
def workoutsplitshowerview(request):
    workoutsplit = Workout_Split.objects.filter(user=request.user)
    return render(request, 'workoutsplitshower.html',{'workoutsplit':workoutsplit})


@login_required
def reps_view(request, pk):
    my_model = get_object_or_404(Workout_Split, pk=pk)
    if my_model.user != request.user:
        return HttpResponseForbidden("You are not allowed to access this page.")
    
    if Weight_and_reps.objects.filter(model=my_model).exists():
        weight_reps_model = Weight_and_reps.objects.filter(model=my_model).latest('date')
    else:
        weight_reps_model = Weight_and_reps(model=my_model)
    
    form = Weight_and_reps_form(request.POST)
    if request.method == 'POST':
        if request.POST.get('form_submit'):
            if form.is_valid():
                weight = form.cleaned_data['weight']
                reps = form.cleaned_data['reps']
                if weight_reps_model.reps != "":
                    weight_reps_model.reps += " "
                    weight_reps_model.weight += " "
                weight_reps_model.reps += str(reps) + ","
                weight_reps_model.weight += str(weight) + ","
                weight_reps_model.save()
                
        elif request.POST.get('next_day'):
            weight_reps_model = Weight_and_reps.objects.create(model=my_model)
              
    workoutsplit = Weight_and_reps.objects.filter(model=my_model).order_by('-date')
    name = my_model.name
    
    context = {}
    context['form'] = form
    context['workoutsplit'] = workoutsplit
    context['name'] = name
    return render(request, 'replist.html', context)
