from django.urls import reverse_lazy
from django.shortcuts import redirect, render

    
def home_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    return render(request, 'index.html')


def about_view(request):
    if not request.user.is_authenticated:
        return redirect(reverse_lazy('login'))
    
    return render(request, 'about.html')