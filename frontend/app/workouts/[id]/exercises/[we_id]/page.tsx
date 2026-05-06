"use client"

import Link from "next/link"
import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  Activity,
  History as HistoryIcon,
  ListPlus,
  Trophy,
} from "lucide-react"
import { localApi as api } from "@/lib/store"
import { useAuth } from "@/components/auth/AuthProvider"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { SetLogger } from "@/components/workouts/SetLogger"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseRecords } from "@/components/workouts/ExerciseRecords"
import { cn } from "@/lib/utils"
import type { ExerciseHistoryDay, Workout, WorkoutExercise } from "@/types"

type Tab = "track" | "chart" | "records" | "history"

export default function ExerciseLoggerPage({
  params,
}: {
  params: Promise<{ id: string; we_id: string }>
}) {
  const { id, we_id } = use(params)
  const router = useRouter()
  const { user, loading } = useAuth()

  const [workout, setWorkout] = useState<Workout | null>(null)
  const [we, setWe] = useState<WorkoutExercise | null>(null)
  const [history, setHistory] = useState<ExerciseHistoryDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("track")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  const refresh = useCallback(async () => {
    try {
      const w = await api.getWorkout(Number(id))
      setWorkout(w)
      const found = w.exercises.find((e) => e.id === Number(we_id))
      setWe(found ?? null)
      if (!found) {
        setError("Exercise not found on this workout.")
        return
      }
      const hist = await api.exerciseHistory(found.exercise.id)
      setHistory(hist)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    }
  }, [id, we_id])

  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        Loading…
      </div>
    )
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
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <SetLogger
            workoutExerciseId={we.id}
            sets={we.sets}
            fallback={getPreviousFirstSet(allHistory, workout?.date)}
            isPlanned={workout?.status === "planned"}
            onChanged={refresh}
          />
        )
      )}

      {tab === "chart" && (
        history === null ? (
          <p className="text-sm text-muted-foreground">Loading chart…</p>
        ) : (
          <ExerciseChart history={history} />
        )
      )}

      {tab === "records" && (
        history === null ? (
          <p className="text-sm text-muted-foreground">Loading records…</p>
        ) : (
          <ExerciseRecords history={allHistory} />
        )
      )}

      {tab === "history" && (
        history === null ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
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
