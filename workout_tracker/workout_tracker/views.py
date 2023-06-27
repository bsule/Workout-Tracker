from django.views.generic import TemplateView
from django.urls import reverse_lazy
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required

class HomePage(TemplateView):
    template_name = 'index.html'
    
    def dispatch(self, request, *args, **kwargs): # if user is not logged in redirect to login page
        if not request.user.is_authenticated:
            return redirect(reverse_lazy('login'))
        return super(HomePage, self).dispatch(request, *args, **kwargs)

@login_required
def about_view(request):
    return render(request, 'about.html')