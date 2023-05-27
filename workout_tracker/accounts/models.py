from django.contrib import auth
from django.contrib.auth.models import User

class User(auth.models.User, auth.models.PermissionsMixin):

    User._meta.get_field('email')._unique = True # make email be unique
    User._meta.get_field('username')._unique = True

    def __str__(self):
        return self.username