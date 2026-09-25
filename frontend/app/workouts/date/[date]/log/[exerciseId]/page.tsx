"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import {
  addExerciseToWorkout,
  createWorkout,
  getWorkoutByDateQ,
  listExercisesQ,
  useHydrated,
  useStore,
} from "@/lib/store"
import { FullPageLoader } from "@/components/ui/Spinner"
import { useAuth } from "@/components/auth/AuthProvider"
import { ExerciseLoggerView } from "@/components/workouts/ExerciseLoggerView"
import { loggerHref } from "@/lib/loggerHref"
import { todayString } from "@lift/core/dates"
import type { Exercise } from "@/types"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The set logger before the workout or its exercise row exists (mobile's
 * `pendingCreate`). Nothing is written until the first saved set, which
 * creates the workout (or reuses that day's), adds the exercise and logs the
 * set in one batch, then moves to the real logger route. Backing out creates
 * nothing. If the day's workout already has this exercise, this redirects.
 */
export default function PendingLoggerPage({
  params,
}: {
  params: Promise<{ date: string; exerciseId: string }>
}) {
  const { date, exerciseId: exerciseIdParam } = use(params)
  const exerciseId = Number(exerciseIdParam)
  const router = useRouter()
  const { user, loading } = useAuth()
  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)

  const exercise = useMemo<Exercise | null>(() => {
    if (!hydrated) return null
    return listExercisesQ().find((e) => e.id === exerciseId) ?? null
  }, [hydrated, snapshot, exerciseId])

  const existingWorkout = useMemo(
    () => (hydrated && DATE_RE.test(date) ? getWorkoutByDateQ(date) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, date, snapshot]
  )
  const existingWe =
    existingWorkout?.exercises.find((e) => e.exercise.id === exerciseId) ?? null

  const createdWorkoutId = useRef<number | null>(null)
  const navigated = useRef(false)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  // Already on that day's workout: log against the real row instead.
  useEffect(() => {
    if (navigated.current || !existingWorkout || !existingWe) return
    navigated.current = true
    router.replace(loggerHref(existingWorkout.id, existingWe.id))
  }, [existingWorkout, existingWe, router])

  if (loading || !user || !hydrated) {
    return <FullPageLoader />
  }

  if (!exercise || !DATE_RE.test(date)) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-6 sm:py-10">
        <Link
          href={DATE_RE.test(date) ? `/workouts/date/${date}` : "/workouts"}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Workout
        </Link>
        <p className="text-sm text-muted-foreground">Exercise not found.</p>
      </div>
    )
  }

  // A future day's workout is a plan, so its first save adds a target, the
  // same as the real route on a planned workout. createWorkout infers the
  // same status from the date.
  const isPlanned = existingWorkout
    ? existingWorkout.status === "planned"
    : date > todayString()

  // Once the row exists (the first save, or it was already there) this shows
  // the real row until the redirect lands, so the form never blinks out.
  return (
    <ExerciseLoggerView
      workoutDate={date}
      isPlanned={isPlanned}
      exercise={existingWe?.exercise ?? exercise}
      weId={existingWe?.id ?? null}
      sets={existingWe?.sets ?? []}
      note={existingWe?.note ?? ""}
      createTarget={() => {
        const wid = getWorkoutByDateQ(date)?.id ?? createWorkout(date).row.id
        createdWorkoutId.current = wid
        return addExerciseToWorkout(wid, exercise.id).id
      }}
      onCreated={(weId) => {
        const wid = createdWorkoutId.current
        if (wid == null || navigated.current) return
        navigated.current = true
        router.replace(loggerHref(wid, weId))
      }}
      onExerciseDeleted={() => router.replace(`/workouts/date/${date}`)}
    />
  )
}
