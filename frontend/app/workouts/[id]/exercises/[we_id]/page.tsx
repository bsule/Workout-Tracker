"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import {
  useStore,
  useHydrated,
  localApi as api,
  deleteWorkout,
} from "@/lib/store"
import { FullPageLoader } from "@/components/ui/Spinner"
import { getWorkoutQ } from "@/lib/store/queries"
import { useAuth } from "@/components/auth/AuthProvider"
import { ExerciseLoggerView } from "@/components/workouts/ExerciseLoggerView"
import { isEmptyWorkoutShell } from "@lift/core/workouts"

export default function ExerciseLoggerPage({
  params,
}: {
  params: Promise<{ id: string; we_id: string }>
}) {
  const { id, we_id } = use(params)
  const router = useRouter()
  const { user, loading } = useAuth()
  const hydrated = useHydrated()
  // Subscribe to the snapshot reference so we re-render on any mutation.
  // Materialization is done via useMemo below: calling getWorkoutQ inside
  // useStore directly would trip useSyncExternalStore's getSnapshot cache.
  const snapshot = useStore((s) => s.snapshot)

  const workout = useMemo(
    () => (hydrated ? getWorkoutQ(Number(id)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, id, snapshot],
  )
  const we = useMemo(
    () => workout?.exercises.find((e) => e.id === Number(we_id)) ?? null,
    [workout, we_id],
  )

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  // On leave, if no set was ever logged on this exercise, drop the empty row
  // so it doesn't show up as a ghost on the day view. If that leaves an empty
  // shell of a workout (core isEmptyWorkoutShell), delete the workout too.
  //
  // The check runs a tick after unmount and is skipped when the same page
  // mounted again in between: React's dev double-mount would otherwise run
  // it on arrival.
  const activeKey = useRef<string | null>(null)
  useEffect(() => {
    const workoutId = Number(id)
    const weId = Number(we_id)
    const key = `${workoutId}:${weId}`
    activeKey.current = key
    return () => {
      activeKey.current = null
      setTimeout(() => {
        if (activeKey.current === key) return
        const w = getWorkoutQ(workoutId)
        if (!w) return
        const currentWe = w.exercises.find((e) => e.id === weId)
        if (!currentWe || currentWe.sets.length > 0) return
        if (w.exercises.length === 1 && isEmptyWorkoutShell(w)) {
          deleteWorkout(workoutId)
        } else {
          void api.removeExerciseFromWorkout(workoutId, weId)
        }
      }, 0)
    }
  }, [id, we_id])

  if (loading || !user || !hydrated) {
    return <FullPageLoader />
  }

  if (!workout || !we) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-6 sm:py-10">
        <Link
          href={workout ? `/workouts/date/${workout.date}` : "/workouts"}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Workout
        </Link>
        <p className="text-sm text-muted-foreground">Exercise not found.</p>
      </div>
    )
  }

  return (
    <ExerciseLoggerView
      workoutDate={workout.date}
      isPlanned={workout.status === "planned"}
      exercise={we.exercise}
      weId={we.id}
      sets={we.sets}
      note={we.note}
      onExerciseDeleted={() => router.replace(`/workouts/date/${workout.date}`)}
    />
  )
}
