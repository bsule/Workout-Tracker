from django.views.generic import TemplateView
from django.urls import reverse_lazy
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
    
def home_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    table = [
        {"y":200, "label": "August 2"},
        {"y":225, "label": "August 3"},
        {"y":226, "label": "August 5"},
    ]
    
    return render(request, 'index.html', {'table': table})

@login_required
def about_view(request):
    return render(request, 'about.html')