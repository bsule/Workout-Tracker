"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Files, FilePlus2 } from "lucide-react"
import { PrIcon } from "@/components/workouts/PrIcon"
import { useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"
import {
  cn,
  formatDuration,
  parseLocalDate,
} from "@/lib/utils"
import type { Workout, WorkoutExercise } from "@/types"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { DateNav } from "@/components/layout/DateNav"

interface Props {
  date: string
}

export function DayView({ date }: Props) {
  const router = useRouter()
  const [workout, setWorkout] = useState<Workout | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(d: string) {
    setError(null)
    setWorkout(undefined)
    try {
      const w = await api.getWorkoutByDate(d)
      setWorkout(w)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workout")
      setWorkout(null)
    }
  }

  useEffect(() => {
    load(date)
  }, [date])

  function changeDate(next: string) {
    router.push(`/workouts/date/${next}`)
  }

  async function startWorkout() {
    setBusy(true)
    setError(null)
    try {
      const w = await api.createWorkout(date)
      setWorkout(w)
      router.push(`/exercises?pickFor=${w.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start workout")
    } finally {
      setBusy(false)
    }
  }

  async function copyPrevious() {
    setBusy(true)
    setError(null)
    try {
      // Find the most recent prior workout.
      const list = await api.listWorkouts()
      const earlier = list
        .filter((w) => w.date < date)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
      const source = earlier[0]
      if (!source) {
        setError("No previous workout to copy from.")
        return
      }
      const target = await api.createWorkout(date)
      const updated = await api.copyFromWorkout(target.id, source.id, false)
      setWorkout(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to copy workout")
    } finally {
      setBusy(false)
    }
  }

  async function deleteWorkout() {
    if (!workout) return
    if (!confirm("Delete this entire day? All sets will be lost.")) return
    setBusy(true)
    try {
      await api.deleteWorkout(workout.id)
      setWorkout(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete workout")
    } finally {
      setBusy(false)
    }
  }

  async function removeExercise(weId: number) {
    if (!workout) return
    if (!confirm("Remove this exercise and all its sets?")) return
    try {
      await api.removeExerciseFromWorkout(workout.id, weId)
      const refreshed = await api.getWorkout(workout.id)
      setWorkout(refreshed)
    } catch (e) {
      if (e instanceof ApiError) setError(e.message)
    }
  }

  return (
    <div className="space-y-5">
      <DateNav date={date} onChange={changeDate} />

      {workout === undefined && (
        <div className="rounded-md border border-white/10 p-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {workout === null && (
        <EmptyDay
          busy={busy}
          onStart={startWorkout}
          onCopy={copyPrevious}
        />
      )}

      {workout && (
        <>
          <SummaryStrip workout={workout} />

          {workout.exercises.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground">
              No exercises yet. Add one below.
            </div>
          ) : (
            <div className="space-y-4">
              {workout.exercises.map((we) => (
                <ExerciseCard
                  key={we.id}
                  workoutId={workout.id}
                  we={we}
                  onRemove={() => removeExercise(we.id)}
                />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={`/exercises?pickFor=${workout.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="size-4" />
              Add Exercise
            </Link>
            <button
              onClick={deleteWorkout}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
            >
              <Trash2 className="size-3.5" />
              Delete this day
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryStrip({ workout }: { workout: Workout }) {
  const dur = formatDuration(workout.duration_seconds)
  const dt = parseLocalDate(workout.date)
  const niceDate = dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  return (
    <div className="rounded-lg border border-white/10 bg-white/[.02] p-4">
      <div className="text-sm text-muted-foreground">{niceDate}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {workout.started_at && (
          <span>
            <span className="text-foreground/70">Started </span>
            {new Date(workout.started_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
        {workout.finished_at && (
          <span>
            <span className="text-foreground/70">Finished </span>
            {new Date(workout.finished_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
        {dur && (
          <span>
            <span className="text-foreground/70">Duration </span>
            {dur}
          </span>
        )}
      </div>
    </div>
  )
}

function ExerciseCard({
  workoutId,
  we,
  onRemove,
}: {
  workoutId: number
  we: WorkoutExercise
  onRemove: () => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-card">
      <div className="flex items-center gap-2 border-b border-white/5 bg-white/[.02] px-4 py-3">
        <CategoryDot category={we.exercise.category} />
        <Link
          href={`/workouts/${workoutId}/exercises/${we.id}`}
          className="flex-1 text-base font-semibold tracking-tight hover:text-primary"
        >
          {we.exercise.name}
        </Link>
        <button
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
          aria-label="Remove exercise"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {we.sets.length === 0 ? (
        <Link
          href={`/workouts/${workoutId}/exercises/${we.id}`}
          className="block px-4 py-4 text-sm text-primary hover:bg-white/[.02]"
        >
          + Add first set
        </Link>
      ) : (
        <ul className="divide-y divide-white/5">
          {we.sets.map((s, i) => (
            <li key={s.id} className="px-4 py-2 text-sm">
              <div className="flex items-center gap-3">
                <PrIcon
                  isPr={s.is_pr}
                  wasPr={s.was_pr}
                  className="size-4"
                />
                <span className="w-6 text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1 text-right text-base font-semibold tabular-nums">
                  {s.weight}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    lb
                  </span>
                </span>
                <span className="w-16 text-right text-base font-semibold tabular-nums">
                  {s.reps}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    reps
                </span>
                </span>
              </div>
              {s.note && (
                <p className="mt-1 ml-7 whitespace-pre-wrap text-xs italic text-muted-foreground">
                  {s.note}
                </p>
              )}
            </li>
          ))}
          <li>
            <Link
              href={`/workouts/${workoutId}/exercises/${we.id}`}
              className="block px-4 py-2 text-sm text-primary hover:bg-white/[.02]"
            >
              + Add set
            </Link>
          </li>
        </ul>
      )}
    </div>
  )
}

function EmptyDay({
  busy,
  onStart,
  onCopy,
}: {
  busy: boolean
  onStart: () => void
  onCopy: () => void
}) {
  return (
    <div className="grid gap-6 py-10 sm:grid-cols-2">
      <button
        onClick={onStart}
        disabled={busy}
        className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-10 text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        <FilePlus2 className="size-12" />
        <span className="text-base font-semibold">Start New Workout</span>
      </button>
      <button
        onClick={onCopy}
        disabled={busy}
        className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-10 text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        <Files className="size-12" />
        <span className="text-base font-semibold">Copy Previous Workout</span>
      </button>
    </div>
  )
}
