"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  Activity,
  History as HistoryIcon,
  ListPlus,
  Settings as SettingsIcon,
  ScrollText,
} from "lucide-react"
import {
  useStore,
  useHydrated,
  localApi as api,
  deleteWorkout,
  setExerciseNote,
} from "@/lib/store"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { getWorkoutQ, getExerciseHistoryQ } from "@/lib/store/queries"
import { useAuth } from "@/components/auth/AuthProvider"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import {
  useShowLastTime,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
import { ExerciseNoteField } from "@/components/workouts/ExerciseNoteField"
import { SetLogger } from "@/components/workouts/SetLogger"
import { LastTimePanel } from "@/components/workouts/LastTimePanel"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseSummary } from "@/components/workouts/ExerciseSummary"
import { cn } from "@/lib/utils"
import type { Category, Exercise, ExerciseHistoryDay } from "@/types"

type Tab = "track" | "chart" | "summary" | "history" | "settings"

export default function ExerciseLoggerPage({
  params,
}: {
  params: Promise<{ id: string; we_id: string }>
}) {
  const { id, we_id } = use(params)
  const router = useRouter()
  const { user, loading } = useAuth()
  const hydrated = useHydrated()
  const unit = useWeightUnit()
  const showLastTime = useShowLastTime()
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
          <div className="flex items-start gap-3">
            <CategoryDot category={we.exercise.category} size="md" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight">
                {we.exercise.name}
              </h1>
              <ExerciseNoteField
                note={we.note}
                onSave={(text) => setExerciseNote(we.id, text)}
              />
            </div>
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
          <div className="space-y-6">
            <SetLogger
              workoutExerciseId={we.id}
              sets={we.sets}
              fallback={getPreviousTopSet(allHistory, workout?.date)}
              isPlanned={workout?.status === "planned"}
              prevWorkoutLastSetIso={getPriorExerciseLastSetIso(workout, we.id)}
            />
            {showLastTime && workout && (
              <LastTimePanel
                days={allHistory}
                currentDate={workout.date}
                nextPosition={we.sets.filter((s) => !s.is_planned).length + 1}
                isWeightReps={we.exercise.kind === "weight_reps"}
                unit={unit}
                onShowMore={() => setTab("summary")}
              />
            )}
          </div>
        )
      )}

      {tab === "chart" && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <ExerciseChart history={history} />
        )
      )}

      {tab === "summary" && (
        history === null ? (
          <LoadingBlock />
        ) : (
          <ExerciseSummary history={allHistory} excludeDate={workout?.date} />
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

      {tab === "settings" && we && (
        <ExerciseSettingsPanel
          exercise={we.exercise}
          onDeleted={() => {
            router.replace(workout ? `/workouts/date/${workout.date}` : "/workouts")
          }}
        />
      )}
    </div>
  )
}

function ExerciseSettingsPanel({
  exercise,
  onDeleted,
}: {
  exercise: Exercise
  onDeleted: () => void
}) {
  const confirm = useConfirm()
  const { categories, labels } = useCategoryStyles()
  const [name, setName] = useState(exercise.name)
  const [category, setCategory] = useState<Category>(exercise.category)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Name cannot be empty.")
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.patchExercise(exercise.id, { name: trimmed, category })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save exercise")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${exercise.name}"?`,
      message:
        (exercise.workouts_count ?? 0) > 0
          ? `Past workouts that logged "${exercise.name}" will keep their history, but it will be removed from your exercise list.`
          : `"${exercise.name}" will be permanently removed.`,
      destructive: true,
      confirmLabel: "Delete Exercise",
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.deleteExercise(exercise.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete exercise")
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-white/10 bg-white/[.02] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Exercise Details
        </p>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {categories.map((c) => (
              <option key={c} value={c} className="bg-neutral-900 text-foreground">
                {labels[c] ?? c}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Tools
        </p>
        <Link
          href="/one-rep-max"
          className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[.02] p-4 hover:border-white/20 hover:bg-white/[.04] transition-colors"
        >
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              1 Rep Max Calculator
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Plug in any weight × reps to estimate your 1RM and a percentage table.
            </p>
          </div>
          <ChevronLeft className="size-4 rotate-180 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </div>

      <div className="space-y-3 pt-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-destructive/80">
          Danger Zone
        </p>
        <div className="rounded-xl border border-destructive/20 bg-destructive/[.03] p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Delete this exercise</p>
            <p className="text-xs text-muted-foreground">
              Removes it from your exercise list.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Most recent prior workout's top set (heaviest weight, earliest on a tie),
 * used to pre-fill the SetLogger when the current day has no sets logged yet.
 * Matches mobile's prefill.
 */
function getPreviousTopSet(
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
  if (!ordered.length) return null
  const top = ordered.reduce((best, s) => (s.weight > best.weight ? s : best))
  return { weight: top.weight, reps: top.reps }
}

function getPriorExerciseLastSetIso(
  workout: { exercises: { id: number; sets: { is_planned?: boolean; created_at: string }[] }[] } | null | undefined,
  currentWeId: number,
): string | null {
  if (!workout) return null
  let latest: string | null = null
  for (const we of workout.exercises) {
    if (we.id === currentWeId) continue
    for (const s of we.sets) {
      if (s.is_planned) continue
      if (latest === null || Date.parse(s.created_at) > Date.parse(latest)) {
        latest = s.created_at
      }
    }
  }
  return latest
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
    { id: "track", label: "Workout", icon: <ListPlus className="size-4" /> },
    {
      id: "history",
      label: "History",
      icon: <HistoryIcon className="size-4" />,
      badge: priorCount > 0 ? String(priorCount) : undefined,
    },
    { id: "chart", label: "Graph", icon: <Activity className="size-4" /> },
    { id: "summary", label: "Summary", icon: <ScrollText className="size-4" /> },
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon className="size-4" />,
    },
  ]
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1">
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
