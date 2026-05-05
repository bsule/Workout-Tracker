from django.urls import path

from . import views

urlpatterns = [
    path(
        "workouts/",
        views.WorkoutSplitListCreateView.as_view(),
        name="workout-list",
    ),
    path(
        "workouts/<int:pk>/",
        views.WorkoutSplitDetailView.as_view(),
        name="workout-detail",
    ),
    path(
        "workouts/<int:split_id>/sessions/",
        views.create_session_view,
        name="session-create",
    ),
    path(
        "sessions/<int:session_id>/",
        views.delete_session_view,
        name="session-delete",
    ),
    path(
        "sessions/<int:session_id>/sets/",
        views.add_set_view,
        name="set-add",
    ),
    path("calculator/", views.calculator_view, name="calculator"),
]
