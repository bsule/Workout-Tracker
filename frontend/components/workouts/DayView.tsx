"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Play, CalendarClock } from "lucide-react"
import { PrIcon } from "@/components/workouts/PrIcon"
import { useMemo, useState } from "react"
import {
  localApi as api,
  lastSetTimeOf,
  startPlannedWorkout,
  useHydrated,
  useStore,
  getWorkoutByDateQ,
  listGymsQ,
  workoutDurationSeconds,
} from "@/lib/store"
import {
  cn,
  formatDuration,
  parseLocalDate,
} from "@/lib/utils"
import type { Workout, WorkoutExercise } from "@/types"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { DateNav } from "@/components/layout/DateNav"
import { GymEditor } from "@/components/workouts/GymEditor"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { LoadingBlock } from "@/components/ui/Spinner"
import {
  useShowPositionPrs,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
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
  const rawWorkout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    [hydrated, date, snapshot]
  )
  // Hide WEs that have no sets yet — they're transient placeholders the
  // exercise picker creates before the user has saved their first set.
  // The cleanup hook in the SetLogger page still purges them from the
  // store; this just gates visibility so we don't flash an empty card on
  // navigation. If filtering empties the workout AND it has no other
  // state (gym, started_at, planned), treat it as not-yet-existing.
  const workout = useMemo(() => {
    if (!rawWorkout) return rawWorkout
    const visibleExercises = rawWorkout.exercises.filter(
      (we) => we.sets.length > 0
    )
    if (
      visibleExercises.length === 0 &&
      !rawWorkout.started_at &&
      !rawWorkout.gym &&
      !rawWorkout.notes &&
      rawWorkout.status !== "planned"
    ) {
      return null
    }
    return { ...rawWorkout, exercises: visibleExercises }
  }, [rawWorkout])
  const lastGym = useMemo(
    () => (hydrated ? listGymsQ()[0]?.name ?? null : null),
    [hydrated, snapshot]
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeDate(next: string) {
    router.push(`/workouts/date/${next}`)
  }

  async function startPlanned() {
    if (!workout || workout.status !== "planned") return
    setBusy(true)
    setError(null)
    try {
      startPlannedWorkout(workout.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start workout")
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove exercise")
    }
  }


  return (
    <div className="space-y-5">
      <DateNav date={date} onChange={changeDate} />

      {workout === undefined && <LoadingBlock />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {workout === null && (
        <>
          <DateStrip date={date} />
          <div className="rounded-md border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground">
            No exercises yet. Add one below.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={`/exercises?forDate=${date}`}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="size-4" />
              Add Exercise
            </Link>
          </div>
        </>
      )}

      {workout && (
        <>
          <SummaryStrip workout={workout} lastGym={lastGym} />

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
}: {
  workout: Workout
  lastGym: string | null
}) {
  // Show start/end/duration whenever the workout has a real `started_at` —
  // that's only set when the workout was originally created on its own day.
  // Past workouts that were logged retroactively start with started_at=null
  // and stay clean. Today's recorded times persist into future views forever.
  const hasTime = !!workout.started_at
  const lastTime = hasTime ? lastSetTimeOf(workout) : null
  const dur = hasTime ? formatDuration(workoutDurationSeconds(workout)) : null
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
          {lastTime && (
            <span>
              <span className="text-foreground/70">End </span>
              {new Date(lastTime).toLocaleTimeString("en-US", {
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
  const showPositionPrs = useShowPositionPrs()
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
                ) : s.is_pr || s.was_pr ? (
                  <PrIcon
                    isPr={s.is_pr}
                    wasPr={s.was_pr}
                    className="size-4"
                  />
                ) : showPositionPrs ? (
                  <PrIcon
                    isPr={s.is_position_pr}
                    wasPr={s.was_position_pr}
                    variant="position"
                    position={i + 1}
                  />
                ) : (
                  <PrIcon isPr={false} wasPr={false} className="size-4" />
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

function DateStrip({ date }: { date: string }) {
  const dt = parseLocalDate(date)
  const niceDate = dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  return (
    <div className="rounded-lg border border-white/10 bg-white/[.02] p-4">
      <div className="text-sm text-muted-foreground">{niceDate}</div>
    </div>
  )
}
