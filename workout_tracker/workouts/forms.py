from django.forms import ModelForm
from .models import *
from django import forms
from django.contrib.auth.models import User
from django.shortcuts import redirect


class Workout_SplitForm(ModelForm):
    
    class Meta:
        model = Workout_Split
        fields = ['name']
    

class Workout_SplitReps(ModelForm):
    
    class Meta:
        model = Workout_Split
        fields = ['reps']
    
class Weight_and_reps(forms.Form):
    weight = forms.IntegerField()
    reps = forms.IntegerField()
    
        
    
    