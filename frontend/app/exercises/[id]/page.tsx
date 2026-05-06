"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  ChevronLeft,
  History as HistoryIcon,
  ListPlus,
  Trophy,
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthProvider"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { Button } from "@/components/ui/button"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseRecords } from "@/components/workouts/ExerciseRecords"
import { localApi as api, useHydrated, useStore } from "@/lib/store"
import { getExerciseHistoryQ, listExercisesQ } from "@/lib/store/queries"
import { cn } from "@/lib/utils"
import type { Exercise, ExerciseHistoryDay } from "@/types"

type Tab = "chart" | "records" | "history"

export default function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const exerciseId = Number(id)
  const router = useRouter()
  const { user, loading } = useAuth()
  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>("history")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  const exercise: Exercise | null = useMemo(() => {
    if (!hydrated || !Number.isFinite(exerciseId)) return null
    return listExercisesQ({ sort: "name" }).find((e) => e.id === exerciseId) ?? null
  }, [hydrated, exerciseId, snapshot])

  const history: ExerciseHistoryDay[] | null = useMemo(() => {
    if (!hydrated || !Number.isFinite(exerciseId)) return null
    return getExerciseHistoryQ(exerciseId)
  }, [hydrated, exerciseId, snapshot])

  async function logToday() {
    if (!exercise) return
    setBusy(true)
    setError(null)
    try {
      const today = todayString()
      const workout = await api.createWorkout(today)
      if (workout.merged_into_finished) {
        const ok = await confirm({
          title: "Already finished a workout today",
          message:
            "You have a finished session for today. Logging will add this exercise to that same session.",
          confirmLabel: "Log there",
        })
        if (!ok) {
          setBusy(false)
          return
        }
      }
      const we = await api.addExerciseToWorkout(workout.id, exercise.id)
      router.push(`/workouts/${workout.id}/exercises/${we.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open logger")
      setBusy(false)
    }
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  const allHistory = history ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-6">
      <div className="space-y-3">
        <Link
          href="/exercises"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Exercises
        </Link>

        {exercise ? (
          <div className="flex items-center gap-3">
            <CategoryDot category={exercise.category} size="md" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {exercise.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {formatCount(exercise.workouts_count ?? allHistory.length)}
              </p>
            </div>
            <Button onClick={logToday} disabled={busy}>
              <ListPlus className="size-4" />
              {busy ? "Opening..." : "Log"}
            </Button>
          </div>
        ) : (
          <h1 className="text-xl font-bold tracking-tight">Exercise</h1>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!hydrated && <LoadingBlock />}
      {hydrated && !exercise && (
        <p className="text-sm text-destructive">Exercise not found.</p>
      )}

      {exercise && (
        <>
          <Tabs active={tab} onChange={setTab} priorCount={allHistory.length} />

          {tab === "chart" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseChart history={history} />
            ))}

          {tab === "records" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseRecords history={allHistory} />
            ))}

          {tab === "history" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseHistory history={allHistory} />
            ))}
        </>
      )}
    </div>
  )
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
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1">
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

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatCount(count: number): string {
  return count === 1 ? "1 workout" : `${count} workouts`
}
