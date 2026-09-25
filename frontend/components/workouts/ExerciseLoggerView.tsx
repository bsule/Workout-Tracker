"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  Activity,
  ChevronLeft,
  FileText,
  History as HistoryIcon,
  ListPlus,
  ScrollText,
  Settings as SettingsIcon,
} from "lucide-react"
import { setExerciseNote, useStore } from "@/lib/store"
import { getExerciseHistoryQ, getWorkoutByDateQ } from "@/lib/store/queries"
import { ActionMenu } from "@/components/ui/ActionMenu"
import { NoteSheet } from "@/components/ui/NoteSheet"
import { CategoryDot } from "@/components/exercises/CategoryBadge"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import {
  useSettings,
  useShowLastTime,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
import { NotePreview } from "@/components/workouts/NotePreview"
import { SetLogger } from "@/components/workouts/SetLogger"
import { LastTimePanel } from "@/components/workouts/LastTimePanel"
import { ExerciseChart } from "@/components/workouts/ExerciseChart"
import { ExerciseHistory } from "@/components/workouts/ExerciseHistory"
import { ExerciseSummary } from "@/components/workouts/ExerciseSummary"
import { ExerciseSettingsPanel } from "@/components/workouts/ExerciseSettingsPanel"
import { historyDaysThrough, isCardioCategory, latestOtherSetIso } from "@lift/core/setLogger"
import { cn } from "@/lib/utils"
import type { Exercise, WorkoutSet } from "@/types"

type Tab = "track" | "chart" | "summary" | "history" | "settings"

/**
 * The set logger screen: header, sub-tabs and their panels. Shared by the
 * real route (an existing workout exercise row) and the pending route, where
 * `weId` is null until the first saved set creates the workout and the row.
 */
export function ExerciseLoggerView({
  workoutDate,
  isPlanned,
  exercise,
  weId,
  sets,
  note,
  createTarget,
  onCreated,
  onExerciseDeleted,
}: {
  workoutDate: string
  isPlanned: boolean
  exercise: Exercise
  weId: number | null
  sets: WorkoutSet[]
  /** The exercise note for this day ("" when none, or before the row exists). */
  note: string
  createTarget?: () => number
  onCreated?: (weId: number) => void
  onExerciseDeleted: () => void
}) {
  const unit = useWeightUnit()
  const showLastTime = useShowLastTime()
  const { update: updateSettings } = useSettings()
  const { labels } = useCategoryStyles()
  const snapshot = useStore((s) => s.snapshot)
  const [tab, setTab] = useState<Tab>("track")

  const history = useMemo(
    () => getExerciseHistoryQ(exercise.id),
    // Recomputed on every committed change: the snapshot is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.id, snapshot]
  )
  // Found by date, so on the pending route the other exercises of that day's
  // workout still anchor set 1's rest and the ticker.
  const prevWorkoutLastSetIso = useMemo(() => {
    const w = getWorkoutByDateQ(workoutDate)
    return w ? latestOtherSetIso(w.exercises, weId) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutDate, weId, snapshot])

  const isCardio = isCardioCategory(exercise.category)
  const historyCount = historyDaysThrough(history, workoutDate)

  // The exercise note needs a real row to hang on. Before the first set on
  // the pending route there is none, so the menu item says why.
  const noteAvailable = weId != null
  const [exNoteOpen, setExNoteOpen] = useState(false)
  const [exNoteMode, setExNoteMode] = useState<"view" | "edit">("view")
  const [exNoteDraft, setExNoteDraft] = useState("")

  function openExerciseNote() {
    setExNoteDraft(note)
    // Read first, edit on demand; an empty note opens straight at the input.
    setExNoteMode(note.trim() ? "view" : "edit")
    setExNoteOpen(true)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:py-10">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/workouts/date/${workoutDate}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ChevronLeft className="size-4" />
            Workout
          </Link>
          <ActionMenu
            items={[
              {
                label: note.trim() ? "Edit exercise note" : "Add exercise note",
                subtitle: noteAvailable ? undefined : "Log a set first",
                disabled: !noteAvailable,
                onSelect: openExerciseNote,
              },
              {
                label: showLastTime ? "Hide Last time card" : "Show Last time card",
                onSelect: () => void updateSettings({ show_last_time: !showLastTime }),
              },
            ]}
          />
        </div>
        <div className="flex items-start gap-3">
          <CategoryDot category={exercise.category} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{exercise.name}</h1>
            <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {labels[exercise.category] ?? exercise.category}
            </p>
            {/* Only when there is something to read. Writing the first one
                is the menu's job. */}
            {note.trim() && (
              <button
                type="button"
                onClick={openExerciseNote}
                className="-mx-1 mt-1 flex w-full min-w-0 items-start gap-1.5 rounded px-1 pt-0.5 text-left hover:bg-white/5"
                aria-label="Exercise note"
              >
                <FileText className="mt-1 size-3 shrink-0 text-muted-foreground" />
                <NotePreview note={note} className="text-sm text-foreground" />
              </button>
            )}
          </div>
        </div>
      </div>

      <Tabs active={tab} onChange={setTab} priorCount={historyCount} />

      {/* Kept mounted on the other tabs, so the form keeps what was typed. */}
      <div className={cn(tab !== "track" && "hidden")}>
        <SetLogger
          workoutExerciseId={weId}
          sets={sets}
          isCardio={isCardio}
          isPlanned={isPlanned}
          workoutDate={workoutDate}
          history={history}
          prevWorkoutLastSetIso={prevWorkoutLastSetIso}
          createTarget={createTarget}
          onCreated={onCreated}
          renderBelow={(nextPosition) =>
            showLastTime ? (
              <LastTimePanel
                days={history}
                currentDate={workoutDate}
                nextPosition={nextPosition}
                isWeightReps={exercise.kind === "weight_reps"}
                unit={unit}
                onShowMore={() => setTab("summary")}
              />
            ) : null
          }
        />
      </div>

      {tab === "chart" && <ExerciseChart history={history} />}

      {tab === "summary" && <ExerciseSummary history={history} excludeDate={workoutDate} />}

      {tab === "history" && <ExerciseHistory history={history} currentDate={workoutDate} />}

      {tab === "settings" && (
        <ExerciseSettingsPanel exercise={exercise} onDeleted={onExerciseDeleted} />
      )}

      <NoteSheet
        open={exNoteOpen}
        mode={exNoteMode}
        title="Exercise note"
        placeholder="How this exercise went today"
        original={note}
        draft={exNoteDraft}
        onChangeDraft={setExNoteDraft}
        onEdit={() => setExNoteMode("edit")}
        onClose={() => setExNoteOpen(false)}
        onSave={() => {
          if (weId != null) setExerciseNote(weId, exNoteDraft)
        }}
      />
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
    { id: "track", label: "Workout", icon: <ListPlus className="size-4" /> },
    {
      id: "history",
      label: "History",
      icon: <HistoryIcon className="size-4" />,
      badge: priorCount > 0 ? String(priorCount) : undefined,
    },
    { id: "chart", label: "Graph", icon: <Activity className="size-4" /> },
    { id: "summary", label: "Summary", icon: <ScrollText className="size-4" /> },
    { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
  ]
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1">
      {items.map((it) => {
        const isActive = active === it.id
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "relative inline-flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors sm:flex-row sm:gap-1.5 sm:px-2 sm:py-2 sm:text-sm",
              isActive
                ? "bg-white/10 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
                : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
            )}
          >
            {it.icon}
            <span className="max-w-full truncate">{it.label}</span>
            {it.badge && (
              <span
                className={cn(
                  "absolute right-1 top-1 rounded-full px-1.5 text-[10px] font-semibold tabular-nums sm:static sm:ml-1",
                  isActive ? "bg-primary/20 text-primary" : "bg-white/10 text-foreground/70"
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
