from django.shortcuts import render, redirect, get_object_or_404, reverse
from django.urls import reverse_lazy
from .forms import *
from .models import Workout_Split, Weight_and_reps
from django.http import HttpResponseForbidden

# Create your views here.

def delete_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    models = Workout_Split.objects.filter(user=request.user)
    if request.method == 'POST':
        workout_id = request.POST.get('deleted_workout') # get workout user chose to delete
        model = Workout_Split.objects.get(id=workout_id) # and delete it
        
        model.delete()
        return redirect('workoutsplitshowerview')

    content = {}
    content['models'] = models
    return render(request,'delete_workout.html', content)

def delete_day_view(request,pk):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    my_model = Workout_Split.objects.get(id=pk) # check if its the users page and if not then block
    if my_model.user != request.user:
        return HttpResponseForbidden("You are not allowed to access this page.")
    
    if request.method == 'POST':
        workout_id = request.POST.get('deleted_workout')
        model = Weight_and_reps.objects.get(id=workout_id)
        model.delete()
        return redirect('reps_view', pk=my_model.id)
    
    workouts = Weight_and_reps.objects.filter(model=my_model).order_by('-date')
    return render(request,'delete_day.html', {'workouts': workouts})

def calculator_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
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
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
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
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    my_model = get_object_or_404(Workout_Split, pk=pk)
    if my_model.user != request.user:
        return HttpResponseForbidden("You are not allowed to access this page.")
    
    if Weight_and_reps.objects.filter(model=my_model).exists(): # check if the user has workouts made
        weight_reps_model = Weight_and_reps.objects.filter(model=my_model).latest('date')
    else:
        weight_reps_model = Weight_and_reps(model=my_model) # if not then create one
    
    form = Weight_and_reps_form(request.POST)
    if request.method == 'POST':
        if request.POST.get('form_submit'):
            if form.is_valid():
                weight = form.cleaned_data['weight']
                reps = form.cleaned_data['reps']
                
                onerepmax = weight/(1.0278-(.0278*reps))  # calculate one rep max and compare to see
                print(onerepmax)                          # if its higher than the other for the day
                if onerepmax > weight_reps_model.max_weight:
                    weight_reps_model.max_weight = round(onerepmax,1)
                    
                if weight_reps_model.reps != "": # add to the text box of the model (cannot use array because not supported with sqlite)
                    weight_reps_model.reps += " "
                    weight_reps_model.weight += " "
                weight_reps_model.reps += str(reps) + ","
                weight_reps_model.weight += str(weight) + ","
                weight_reps_model.save()
                
        elif request.POST.get('next_day'):
            weight_reps_model = Weight_and_reps.objects.create(model=my_model)
              
    workoutsplit = Weight_and_reps.objects.filter(model=my_model).order_by('-date')
    name = my_model.name
    
    hold2 = Weight_and_reps.objects.filter(model=my_model)[::-1]   # negative indexing not supported so 
    hold2 = hold2[:7]                                              # flip the list and get the last 7 
    hold2 = hold2[::-1]                                            # then flip back
    
    lengthofdata = len(hold2)
    
    context = {}
    context['form'] = form
    context['model'] = my_model
    context['workoutsplit'] = workoutsplit
    context['name'] = name
    context['data'] = hold2
    context['lengthofdata'] = lengthofdata
    return render(request, 'replist.html', context)
