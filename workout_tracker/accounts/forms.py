from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm
from django import forms

class UserCreateForm(UserCreationForm):
    
    class Meta:
        fields = ('first_name', 'last_name','username', 'email', 'password1', 'password2')
        model = get_user_model()
        
        def clean_email(self):
            email = self.cleaned_data.get('email')
            username = self.cleaned_data.get('username')
            if email and User.objects.filter(email=email).exists():
                raise forms.ValidationError(u'Email addresses must be unique.')
            return email
        
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)