"use client"

import Link from "next/link"
import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  ChevronLeft,
  History as HistoryIcon,
  Settings as SettingsIcon,
  ScrollText,
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthProvider"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { Button } from "@/components/ui/button"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseSummary } from "@/components/workouts/ExerciseSummary"
import { localApi as api, useHydrated, useStore } from "@/lib/store"
import { queryAt } from "@/lib/store/queryAt"
import { getExerciseHistoryQ, listExercisesQ } from "@/lib/store/queries"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import { pendingLoggerHref } from "@/lib/loggerHref"
import { cn } from "@/lib/utils"
import { todayString } from "@lift/core/dates"
import { formatRelative } from "@lift/core/format"
import type { Category, Exercise, ExerciseHistoryDay } from "@/types"

type Tab = "chart" | "summary" | "history" | "settings"

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
  const [tab, setTab] = useState<Tab>("history")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  const snapshot = useStore((s) => s.snapshot)
  const exercise: Exercise | null = useMemo(() => {
    if (!hydrated || !Number.isFinite(exerciseId)) return null
    return queryAt(snapshot, () =>
      listExercisesQ({ sort: "name" }).find((e) => e.id === exerciseId) ?? null
    )
  }, [hydrated, exerciseId, snapshot])

  const history: ExerciseHistoryDay[] | null = useMemo(() => {
    if (!hydrated || !Number.isFinite(exerciseId)) return null
    return queryAt(snapshot, () => getExerciseHistoryQ(exerciseId))
  }, [hydrated, exerciseId, snapshot])

  // Mobile's "Log a set": open the logger for today without creating
  // anything; the workout and its exercise row appear with the first set.
  function logToday() {
    if (!exercise) return
    router.replace(pendingLoggerHref(todayString(), exercise.id))
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  const allHistory = history ?? []
  // Only days that have happened: a workout dated in the future can carry
  // logged sets. Same cut as the History tab.
  const today = todayString()
  const pastHistory = allHistory.filter((d) => d.date <= today)
  const lastDate = pastHistory[0]?.date ?? null

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
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {exercise.name}
            </h1>
            <CategoryLabel category={exercise.category} />
          </div>
        ) : (
          <h1 className="text-xl font-bold tracking-tight">Exercise</h1>
        )}

        {exercise && tab === "history" && (
          <>
            <div className="flex gap-3">
              <Stat label="Workouts" value={String(pastHistory.length)} />
              <Stat
                label="Last"
                value={lastDate ? formatRelative(lastDate) : "-"}
              />
            </div>
            <Button onClick={logToday} className="w-full" size="lg">
              Log a set
            </Button>
          </>
        )}
      </div>

      {!hydrated && <LoadingBlock />}
      {hydrated && !exercise && (
        <p className="text-sm text-destructive">Exercise not found.</p>
      )}

      {exercise && (
        <>
          <Tabs active={tab} onChange={setTab} priorCount={pastHistory.length} />

          {tab === "chart" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseChart history={history} />
            ))}

          {tab === "summary" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseSummary history={allHistory} />
            ))}

          {tab === "history" &&
            (history === null ? (
              <LoadingBlock />
            ) : (
              <ExerciseHistory history={allHistory} currentDate={today} />
            ))}

          {tab === "settings" && (
            <ExerciseSettingsPanel
              exercise={exercise}
              onDeleted={() => router.replace("/exercises")}
            />
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 space-y-1 rounded-xl bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}

/** Mobile's CategoryBadge: the category's dot and its name. */
function CategoryLabel({ category }: { category: Category }) {
  const { labels } = useCategoryStyles()
  return (
    <div className="flex items-center gap-1.5">
      <CategoryDot category={category} size="sm" />
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {labels[category] ?? category}
      </span>
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
    <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1">
      {items.map((it) => {
        const isActive = active === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-xs font-medium transition-colors sm:gap-1.5 sm:text-sm",
              isActive
                ? "bg-white/10 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
                : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
            )}
          >
            {it.icon}
            <span>{it.label}</span>
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
            {/* A category the list does not know (a FitNotes import keeps
                unrecognized ones) stays an option, so saving the name does
                not silently switch it to the first one. */}
            {(categories.includes(category) ? categories : [...categories, category]).map((c) => (
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
