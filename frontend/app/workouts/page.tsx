"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Dumbbell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WorkoutCard } from "@/components/workouts/WorkoutCard"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { useAuth } from "@/components/auth/AuthProvider"
import { ApiError, api } from "@/lib/api"
import type { WorkoutSplit } from "@/types"

export default function WorkoutsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [workouts, setWorkouts] = useState<WorkoutSplit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }
    api
      .listWorkouts()
      .then(setWorkouts)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load workouts.")
      )
  }, [authLoading, user, router])

  if (authLoading || workouts === null) {
    return (
      <PageWrapper>
        <div className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              My Workouts
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {workouts.length} routine{workouts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {workouts.length > 0 && (
              <Link href="/workouts/delete">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                >
                  <Trash2 className="size-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </Link>
            )}
            <Link href="/workouts/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="size-3.5" />
                New Workout
              </Button>
            </Link>
          </div>
        </div>

        {error && (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        )}

        {workouts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-6 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <Dumbbell className="size-7 text-primary" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              No workouts yet
            </h2>
            <p className="mb-6 max-w-xs text-sm text-muted-foreground">
              Create your first workout routine to start tracking your progress.
            </p>
            <Link href="/workouts/new">
              <Button className="gap-2">
                <Plus className="size-4" />
                Create your first workout
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workouts.map((workout) => (
              <WorkoutCard key={workout.id} workout={workout} />
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  )
}
