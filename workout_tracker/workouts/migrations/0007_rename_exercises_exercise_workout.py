# Generated by Django 4.2.1 on 2023-06-16 21:56

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0006_delete_workouts'),
    ]

    operations = [
        migrations.RenameModel(
            old_name='Exercises',
            new_name='Exercise',
        ),
        migrations.CreateModel(
            name='Workout',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='workouts.exercise')),
                ('split', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='workouts.workout_split')),
            ],
        ),
    ]