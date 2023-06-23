from django.shortcuts import render, redirect, get_object_or_404
from .forms import *
from .models import Workout_Split, Weight_and_reps
from django.http import HttpResponseForbidden

# Create your views here.

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
        if request.POST.get('next_day'):
            weight_reps_model = Weight_and_reps.objects.create(model=my_model)
            
    workoutsplit = Weight_and_reps.objects.filter(model=my_model).order_by('-date')
    
    context = {}
    context['form'] = form
    context['workoutsplit'] = workoutsplit
    return render(request, 'replist.html', context)
