# Generated by Django 4.2.1 on 2023-06-29 04:49

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workouts', '0006_alter_weight_and_reps_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='weight_and_reps',
            name='max_weight',
            field=models.IntegerField(blank=True, default=0, null=True),
        ),
    ]
