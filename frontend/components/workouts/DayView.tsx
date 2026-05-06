"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Files, FilePlus2, Play, CalendarClock } from "lucide-react"
import { PrIcon } from "@/components/workouts/PrIcon"
import { useMemo, useState } from "react"
import {
  localApi as api,
  startPlannedWorkout,
  useHydrated,
  useStore,
  getWorkoutByDateQ,
  listGymsQ,
} from "@/lib/store"
import {
  cn,
  formatDuration,
  isFutureDate,
  parseLocalDate,
} from "@/lib/utils"
import type { Workout, WorkoutExercise } from "@/types"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { DateNav } from "@/components/layout/DateNav"
import { GymEditor } from "@/components/workouts/GymEditor"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import { formatWeight } from "@/lib/units"

interface Props {
  date: string
}

export function DayView({ date }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const hydrated = useHydrated()
  // Subscribe to the snapshot reference (stable between mutations) and
  // materialize the view via useMemo. `getWorkoutByDateQ` builds a fresh
  // object each call, so calling it directly inside a useStore selector trips
  // React's getSnapshot cache check.
  const snapshot = useStore((s) => s.snapshot)
  const workout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    [hydrated, date, snapshot]
  )
  const lastGym = useMemo(
    () => (hydrated ? listGymsQ()[0]?.name ?? null : null),
    [hydrated, snapshot]
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // No-op kept for handlers that previously called load() after a mutation.
  // The useMemo above re-derives automatically when the snapshot changes.
  function refresh() {}

  function changeDate(next: string) {
    router.push(`/workouts/date/${next}`)
  }

  function startWorkout() {
    // Defer creating the Workout until the user actually picks an exercise,
    // so backing out without picking doesn't leave an empty day around.
    router.push(`/exercises?forDate=${date}`)
  }

  async function startPlanned() {
    if (!workout || workout.status !== "planned") return
    setBusy(true)
    setError(null)
    try {
      startPlannedWorkout(workout.id)
      refresh()
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
      await api.copyFromWorkout(target.id, source.id, false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to copy workout")
    } finally {
      setBusy(false)
    }
  }

  async function removeExercise(weId: number) {
    if (!workout) return
    const ok = await confirm({
      title: "Remove exercise?",
      message: "This exercise and all its sets will be removed from this day.",
      destructive: true,
      confirmLabel: "Remove",
    })
    if (!ok) return
    try {
      await api.removeExerciseFromWorkout(workout.id, weId)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove exercise")
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
        isFutureDate(date) ? (
          <FutureDayBlock />
        ) : (
          <EmptyDay
            busy={busy}
            onStart={startWorkout}
            onCopy={copyPrevious}
          />
        )
      )}

      {workout && (
        <>
          <SummaryStrip
            workout={workout}
            lastGym={lastGym}
            onGymChange={refresh}
          />

          {workout.status === "planned" && (
            <PlannedBanner
              date={workout.date}
              onStart={startPlanned}
              busy={busy}
            />
          )}

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
          </div>
        </>
      )}
    </div>
  )
}

function SummaryStrip({
  workout,
  lastGym,
  onGymChange,
}: {
  workout: Workout
  lastGym: string | null
  onGymChange: () => void
}) {
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
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{niceDate}</div>
        <GymEditor
          workoutId={workout.id}
          gym={workout.gym}
          lastGym={lastGym}
          onChange={onGymChange}
        />
      </div>
      {workout.exercises.length > 0 && (
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
      )}
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
  const router = useRouter()
  const unit = useWeightUnit()
  const href = `/workouts/${workoutId}/exercises/${we.id}`

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          router.push(href)
        }
      }}
      className="overflow-hidden rounded-lg border border-white/10 bg-card cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-center gap-2 border-b border-white/5 bg-white/[.02] px-4 py-3">
        <CategoryDot category={we.exercise.category} />
        <span className="flex-1 text-base font-semibold tracking-tight">
          {we.exercise.name}
        </span>
        <button
          onClick={handleRemove}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
          aria-label="Remove exercise"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {we.sets.length === 0 ? (
        <div className="block px-4 py-4 text-sm text-primary hover:bg-white/[.02]">
          + Add first set
        </div>
      ) : (
        <div className="px-4 pt-3 pb-1">
          <div className="grid grid-cols-[1.25rem_2rem_1fr_4rem] items-center gap-x-4 px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            <span />
            <span>Set</span>
            <span className="text-center">Weight</span>
            <span className="text-right">Reps</span>
          </div>
          <ul className="divide-y divide-white/5">
            {we.sets.map((s, i) => (
              <li
                key={s.id}
                className={cn(
                  "grid grid-cols-[1.25rem_2rem_1fr_4rem] items-center gap-x-4 px-1 py-2",
                  s.is_planned && "opacity-60"
                )}
              >
                {s.is_planned ? (
                  <span
                    className="size-2 rounded-full border border-dashed border-primary/60"
                    aria-label="Target set"
                  />
                ) : (
                  <PrIcon
                    isPr={s.is_pr}
                    wasPr={s.was_pr}
                    className="size-4"
                  />
                )}
                <span className="text-sm font-medium tabular-nums text-foreground/80">
                  {i + 1}
                </span>
                <span
                  className={cn(
                    "text-center text-base font-semibold tabular-nums",
                    s.is_planned && "italic text-muted-foreground"
                  )}
                >
                  {formatWeight(s.weight, unit)}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {unit}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-right text-base font-semibold tabular-nums",
                    s.is_planned && "italic text-muted-foreground"
                  )}
                >
                  {s.reps}
                </span>
                {s.note && (
                  <p className="col-span-4 mt-0.5 ml-8 whitespace-pre-wrap text-xs italic text-muted-foreground">
                    {s.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PlannedBanner({
  date,
  onStart,
  busy,
}: {
  date: string
  onStart: () => void
  busy: boolean
}) {
  const today = todayString()
  const isToday = date === today
  const isFuture = date > today
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
        isToday
          ? "border-primary/40 bg-primary/10"
          : "border-white/10 bg-white/[.02]"
      )}
    >
      <div className="flex items-center gap-3">
        <CalendarClock
          className={cn("size-5", isToday ? "text-primary" : "text-muted-foreground")}
        />
        <div>
          <div className="text-sm font-semibold">
            {isToday
              ? "You have a planned workout today"
              : isFuture
              ? "Planned workout"
              : "Planned (past — never started)"}
          </div>
          <div className="text-xs text-muted-foreground">
            {isFuture
              ? "Edit targets now; start when the day arrives."
              : "Sets shown are targets, not logged yet."}
          </div>
        </div>
      </div>
      {!isFuture && (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Play className="size-4" />
          Start workout
        </button>
      )}
    </div>
  )
}

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

function FutureDayBlock() {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[.02] p-10 text-center">
      <CalendarClock className="mx-auto size-10 text-muted-foreground" />
      <div className="mt-3 text-base font-semibold">Future date</div>
      <p className="mt-1 text-sm text-muted-foreground">
        You can&rsquo;t log a workout for a day that hasn&rsquo;t happened yet.
      </p>
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
