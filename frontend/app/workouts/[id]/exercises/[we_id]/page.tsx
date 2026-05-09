"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  Activity,
  History as HistoryIcon,
  ListPlus,
  Trophy,
} from "lucide-react"
import { useStore, useHydrated, localApi as api, deleteWorkout } from "@/lib/store"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { getWorkoutQ, getExerciseHistoryQ } from "@/lib/store/queries"
import { useAuth } from "@/components/auth/AuthProvider"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { SetLogger } from "@/components/workouts/SetLogger"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseRecords } from "@/components/workouts/ExerciseRecords"
import { cn } from "@/lib/utils"
import type { ExerciseHistoryDay } from "@/types"

type Tab = "track" | "chart" | "records" | "history"

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
  // Materialization is done via useMemo below — calling getWorkoutQ inside
  // useStore directly would trip useSyncExternalStore's getSnapshot cache.
  const snapshot = useStore((s) => s.snapshot)

  const workout = useMemo(
    () => (hydrated ? getWorkoutQ(Number(id)) : null),
    [hydrated, id, snapshot],
  )
  const we = useMemo(
    () => workout?.exercises.find((e) => e.id === Number(we_id)) ?? null,
    [workout, we_id],
  )
  const history: ExerciseHistoryDay[] | null = useMemo(() => {
    if (!hydrated || !we) return null
    return getExerciseHistoryQ(we.exercise.id)
    // history depends on snapshot, not just the WE — pull `snapshot` into deps.
  }, [hydrated, we, snapshot])

  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("track")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  useEffect(() => {
    if (hydrated && workout && we == null) {
      setError("Exercise not found on this workout.")
    } else {
      setError(null)
    }
  }, [hydrated, workout, we])

  // On leave, if no set was ever logged on this exercise, drop the empty
  // WE so it doesn't show up as a ghost row on the day view. If that
  // leaves the workout empty *and* it has no other state (gym, started_at,
  // planned status), delete the workout too — it was only created as a
  // side-effect of the picker flow.
  useEffect(() => {
    const workoutId = Number(id)
    const weId = Number(we_id)
    return () => {
      const w = getWorkoutQ(workoutId)
      if (!w) return
      const currentWe = w.exercises.find((e) => e.id === weId)
      if (!currentWe || currentWe.sets.length > 0) return
      const isOnlyExercise = w.exercises.length === 1
      const isSideEffectWorkout =
        isOnlyExercise &&
        !w.started_at &&
        !w.gym &&
        !w.notes &&
        w.status !== "planned"
      if (isSideEffectWorkout) {
        deleteWorkout(workoutId)
      } else {
        void api.removeExerciseFromWorkout(workoutId, weId)
      }
    }
  }, [id, we_id])

  if (loading || !user) {
    return <FullPageLoader />
  }

  const allHistory = history ?? []
  const historyCount = allHistory.length

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-6">
      <div className="space-y-3">
        <Link
          href={workout ? `/workouts/date/${workout.date}` : "/workouts"}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Workout
        </Link>
        {we && (
          <div className="flex items-center gap-3">
            <CategoryDot category={we.exercise.category} size="md" />
            <h1 className="text-2xl font-bold tracking-tight">
              {we.exercise.name}
            </h1>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Tabs
        active={tab}
        onChange={setTab}
        priorCount={historyCount}
      />

      {tab === "track" && we && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <SetLogger
            workoutExerciseId={we.id}
            sets={we.sets}
            fallback={getPreviousFirstSet(allHistory, workout?.date)}
            isPlanned={workout?.status === "planned"}
          />
        )
      )}

      {tab === "chart" && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <ExerciseChart history={history} />
        )
      )}

      {tab === "records" && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <ExerciseRecords history={allHistory} />
        )
      )}

      {tab === "history" && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <ExerciseHistory
            history={allHistory}
            currentDate={workout?.date}
          />
        )
      )}
    </div>
  )
}

/**
 * Most recent prior workout's first set, used to pre-fill the SetLogger when
 * the current day has no sets logged yet.
 */
function getPreviousFirstSet(
  history: ExerciseHistoryDay[],
  currentDate: string | undefined
): { weight: number; reps: number } | null {
  if (!history.length) return null
  const earlier = history
    .filter((d) => (currentDate ? d.date < currentDate : true) && d.sets.length)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const last = earlier[0]
  if (!last) return null
  const ordered = [...last.sets]
    .filter(
      (s): s is typeof s & { weight: number; reps: number } =>
        s.weight != null && s.reps != null,
    )
    .sort((a, b) => a.order - b.order || a.id - b.id)
  const first = ordered[0]
  if (!first) return null
  return { weight: first.weight, reps: first.reps }
}

function Tabs({
  active,
  onChange,
  priorCount,
}: {
  active: Tab
  onChange: (t: Tab) => void
  priorCount: number
}) {
  const items: { id: Tab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: "track", label: "Track", icon: <ListPlus className="size-4" /> },
    { id: "chart", label: "Chart", icon: <Activity className="size-4" /> },
    { id: "records", label: "Records", icon: <Trophy className="size-4" /> },
    {
      id: "history",
      label: "History",
      icon: <HistoryIcon className="size-4" />,
      badge: priorCount > 0 ? String(priorCount) : undefined,
    },
  ]
  return (
    <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1">
      {items.map((it) => {
        const isActive = active === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-white/10 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
                : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
            )}
          >
            {it.icon}
            <span className="hidden sm:inline">{it.label}</span>
            {it.badge && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums",
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-white/10 text-foreground/70"
                )}
              >
                {it.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
