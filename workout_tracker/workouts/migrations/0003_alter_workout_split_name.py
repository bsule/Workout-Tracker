# Generated by Django 4.2.1 on 2023-06-16 21:26

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0002_alter_workout_split_user'),
    ]

    operations = [
        migrations.AlterField(
            model_name='workout_split',
            name='name',
            field=models.CharField(max_length=200, verbose_name='Routine Name:'),
        ),
    ]