# Generated by Django 4.2.1 on 2023-06-16 21:54

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0004_alter_workouts_name'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='workouts',
            name='description',
        ),
    ]