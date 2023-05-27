from django.views.generic import TemplateView
from django.urls import reverse_lazy

class HomePage(TemplateView):
    template_name = 'index.html'
    def get(self, request, *args, **kwargs):
        if not self.request.user.is_authenticated:
            return reverse_lazy('login')
        return super().get(request, *args, **kwargs)