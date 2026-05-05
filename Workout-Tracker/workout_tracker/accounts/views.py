from django.contrib.auth import login
from django.urls import reverse_lazy
from . import forms
from django.views.generic import CreateView
from django.contrib import messages
from .models import User

class SignUp(CreateView):
    form_class = forms.UserCreateForm
    success_url = reverse_lazy('home')
    template_name ='signup.html'
    
    def form_valid(self, form):
        valid = super().form_valid(form)
        login(self.request, self.object)
        return valid