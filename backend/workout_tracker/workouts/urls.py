from django.urls import path

from . import views

urlpatterns = [
    # exercises
    path("exercises/", views.exercise_list_create, name="exercise-list-create"),
    path("exercises/<int:pk>/", views.exercise_delete, name="exercise-delete"),
    path("exercises/<int:pk>/history/", views.exercise_history, name="exercise-history"),

    # workouts
    path("workouts/", views.workout_list_create, name="workout-list-create"),
    path("workouts/<int:pk>/", views.workout_detail, name="workout-detail"),
    path("workouts/by-date/<str:iso_date>/", views.workout_by_date, name="workout-by-date"),
    path("workouts/<int:pk>/exercises/", views.workout_add_exercise, name="workout-add-exercise"),
    path(
        "workouts/<int:pk>/exercises/<int:we_id>/",
        views.workout_remove_exercise,
        name="workout-remove-exercise",
    ),
    path(
        "workouts/<int:pk>/copy-from/<int:source_id>/",
        views.workout_copy_from,
        name="workout-copy-from",
    ),

    # sets
    path(
        "workout-exercises/<int:we_id>/sets/",
        views.workout_exercise_add_set,
        name="workout-exercise-add-set",
    ),
    path("sets/<int:pk>/", views.set_detail, name="set-detail"),

    # calendar + csv + calc
    path("calendar/", views.calendar_view, name="calendar"),
    path("csv/preview/", views.csv_preview, name="csv-preview"),
    path("csv/import/", views.csv_import, name="csv-import"),
    path("calculator/", views.calculator_view, name="calculator"),
]
