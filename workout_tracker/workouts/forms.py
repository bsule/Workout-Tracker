from django.forms import ModelForm
from .models import *
from django import forms
from django.contrib.auth.models import User


class Workout_SplitForm(ModelForm):
    
    class Meta:
        model = Workout_Split
        fields = ['name']
    
    
class Weight_and_reps_form(forms.Form):
    weight = forms.IntegerField()
    reps = forms.IntegerField()
    

class Max_Rep_Calculator_Form(forms.Form):
    weight = forms.IntegerField()
    reps = forms.IntegerField()
    