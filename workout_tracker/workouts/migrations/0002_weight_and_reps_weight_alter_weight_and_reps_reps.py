# Generated by Django 4.2.1 on 2023-06-22 22:08

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='weight_and_reps',
            name='weight',
            field=models.TextField(blank=True, default='', null=True),
        ),
        migrations.AlterField(
            model_name='weight_and_reps',
            name='reps',
            field=models.TextField(blank=True, default='', null=True),
        ),
    ]
