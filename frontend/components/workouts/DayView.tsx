"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, CirclePlus, Plus, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  localApi as api,
  batchMutations,
  deleteWorkout,
  getDayNoteQ,
  getState,
  getWorkoutByDateQ,
  lastSetTimeOf,
  setDayNote,
  setWorkoutNote,
  startPlannedWorkout,
  useHydrated,
  useStore,
  workoutDurationSeconds,
} from "@/lib/store"
import { addDays, todayString } from "@lift/core/dates"
import { formatDuration, noteActionLabel } from "@lift/core/format"
import { isEmptyWorkoutShell } from "@lift/core/workouts"
import { cn } from "@/lib/utils"
import { setActiveDate } from "@/lib/activeDate"
import type { Workout } from "@/types"
import { DateNav } from "@/components/layout/DateNav"
import { GymEditor } from "@/components/workouts/GymEditor"
import { NotePreview } from "@/components/workouts/NotePreview"
import { ExerciseCard } from "@/components/day/ExerciseCard"
import { PlannedBanner } from "@/components/day/PlannedBanner"
import { ignorePageShortcut } from "@/components/day/keyboard"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { NoteSheet } from "@/components/ui/NoteSheet"
import type { ActionMenuItem } from "@/components/ui/ActionMenu"
import { LoadingBlock } from "@/components/ui/Spinner"

interface Props {
  date: string
}

/** The day view carries two notes: one on the date, one on the session. */
type NoteKind = "day" | "workout"

interface NoteState {
  /** The date the sheet was opened on: a date change drops it, like mobile. */
  date: string
  open: boolean
  mode: "view" | "edit"
  kind: NoteKind
  draft: string
  original: string
}

/**
 * One day's workout, the web copy of mobile's DayScreen. Arrow keys and the
 * arrows in the header move a day; "t" or the "Go to today" pill jumps back.
 * Holding a card starts a multi-select for removing exercises.
 */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, date, snapshot]
  )
  // Hide WEs that have no sets yet: they're transient placeholders the
  // exercise picker creates before the user has saved their first set. If
  // that empties a workout holding nothing else, treat it as not existing.
  const workout = useMemo(() => {
    if (!rawWorkout) return rawWorkout
    const visibleExercises = rawWorkout.exercises.filter(
      (we) => we.sets.length > 0
    )
    if (visibleExercises.length === 0 && isEmptyWorkoutShell(rawWorkout)) {
      return null
    }
    return { ...rawWorkout, exercises: visibleExercises }
  }, [rawWorkout])
  const dayNote = useMemo(
    () => (hydrated ? getDayNoteQ(date) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, date, snapshot]
  )

  // Remember the date for /workouts and the calendar's default selection.
  useEffect(() => {
    setActiveDate(date)
  }, [date])

  const changeDate = useCallback(
    (next: string) => router.push(`/workouts/date/${next}`),
    [router]
  )

  // Selection is tied to the date it was made on, so any date change clears it.
  const [selection, setSelection] = useState<{ date: string; ids: number[] }>({
    date,
    ids: [],
  })
  const selectedIds = useMemo(
    () => (selection.date === date ? selection.ids : []),
    [selection, date]
  )
  const selectionMode = selectedIds.length > 0
  const toggleSelected = useCallback(
    (weId: number) =>
      setSelection((prev) => {
        const ids = prev.date === date ? prev.ids : []
        return {
          date,
          ids: ids.includes(weId)
            ? ids.filter((x) => x !== weId)
            : [...ids, weId],
        }
      }),
    [date]
  )
  const clearSelection = useCallback(
    () => setSelection({ date, ids: [] }),
    [date]
  )

  const [noteState, setNoteState] = useState<NoteState>({
    date,
    open: false,
    mode: "view",
    kind: "day",
    draft: "",
    original: "",
  })
  const noteOpen = noteState.open && noteState.date === date

  const openNoteSheet = useCallback(
    (mode: "view" | "edit", kind: NoteKind) => {
      const n =
        kind === "day"
          ? getDayNoteQ(date)
          : (getState().indexes.workoutsByDate.get(date)?.notes ?? "")
      setNoteState({ date, open: true, mode, kind, draft: n, original: n })
    },
    [date]
  )
  const closeNoteSheet = useCallback(
    () => setNoteState((s) => ({ ...s, open: false })),
    []
  )

  function saveNote() {
    const text = noteState.draft.trim()
    if (noteState.kind === "day") {
      setDayNote(date, text)
      return
    }
    const id = getState().indexes.workoutsByDate.get(date)?.id
    if (id != null) setWorkoutNote(id, text)
  }

  const deleteThisDaysWorkout = useCallback(async () => {
    const wid = getState().indexes.workoutsByDate.get(date)?.id ?? null
    if (wid == null) return
    const ok = await confirm({
      title: "Delete workout?",
      message:
        "All exercises and sets logged this day will be removed.",
      destructive: true,
      confirmLabel: "Delete",
    })
    if (ok) deleteWorkout(wid)
  }, [confirm, date])

  // The date label's menu. The delete item only appears once some exercise
  // on the day has a set, as on mobile.
  const menuItems = useMemo<ActionMenuItem[]>(() => {
    const hasExercises =
      !!rawWorkout && rawWorkout.exercises.some((we) => we.sets.length > 0)
    const items: ActionMenuItem[] = [
      {
        label: noteActionLabel(date, !!dayNote.trim()),
        onSelect: () => openNoteSheet("edit", "day"),
      },
      {
        label: "Open calendar",
        onSelect: () => router.push(`/calendar?date=${date}`),
      },
    ]
    if (hasExercises) {
      items.push({
        label: "Delete this day's workout",
        destructive: true,
        onSelect: () => void deleteThisDaysWorkout(),
      })
    }
    return items
  }, [rawWorkout, dayNote, date, openNoteSheet, router, deleteThisDaysWorkout])

  async function confirmRemoveSelected() {
    if (!workout || selectedIds.length === 0) return
    const count = selectedIds.length
    const ids = selectedIds
    const workoutId = workout.id
    const ok = await confirm({
      title: `Remove ${count} exercise${count === 1 ? "" : "s"}?`,
      message: "All sets logged for these exercises today will be deleted.",
      destructive: true,
      confirmLabel: "Remove",
    })
    if (!ok) return
    // One commit for the batch, and no await inside it: localApi resolves
    // against the in-memory snapshot, so each removal is synchronous.
    batchMutations(() => {
      for (const weId of ids) api.removeExerciseFromWorkout(workoutId, weId)
    })
    clearSelection()
  }

  // Keyboard: Left / Right move a day, "t" jumps to today, Esc ends a
  // selection. Never while typing or while a dialog or menu is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ignorePageShortcut(e)) return
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        changeDate(addDays(date, -1))
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        changeDate(addDays(date, 1))
      } else if (e.key === "t" || e.key === "T") {
        if (e.shiftKey) return
        const today = todayString()
        if (today !== date) changeDate(today)
      } else if (e.key === "Escape" && selectionMode) {
        clearSelection()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [date, changeDate, selectionMode, clearSelection])

  const showSummary = !!(workout || dayNote.trim())
  const showBanner = workout?.status === "planned"
  const isToday = date === todayString()

  return (
    <div className="space-y-4 pb-20">
      <DateNav date={date} onChange={changeDate} menuItems={menuItems} />

      {workout === undefined ? (
        <LoadingBlock />
      ) : (
        <>
          {selectionMode ? (
            <SelectionBar
              count={selectedIds.length}
              onClear={clearSelection}
              onRemove={() => void confirmRemoveSelected()}
            />
          ) : (
            <>
              {showSummary && (
                <SummaryCard
                  workout={workout}
                  note={dayNote}
                  onOpenDayNote={() => openNoteSheet("view", "day")}
                  onOpenWorkoutNote={() => openNoteSheet("view", "workout")}
                />
              )}
              {showBanner && workout && (
                <PlannedBanner
                  date={date}
                  onStart={() => startPlannedWorkout(workout.id)}
                />
              )}
            </>
          )}

          {workout && workout.exercises.length > 0 ? (
            <>
              <div className="flex flex-col gap-3">
                {workout.exercises.map((we) => (
                  <ExerciseCard
                    key={we.id}
                    workoutId={workout.id}
                    we={we}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.includes(we.id)}
                    onToggle={() => toggleSelected(we.id)}
                    onLongPress={() => {
                      if (!selectedIds.includes(we.id)) toggleSelected(we.id)
                    }}
                  />
                ))}
              </div>
              {/* Web has no global "+" tab, so the day keeps its own add. */}
              {!selectionMode && (
                <Link
                  href={`/exercises?pickFor=${workout.id}`}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  <Plus className="size-4" />
                  Add Exercise
                </Link>
              )}
            </>
          ) : (
            <Link
              href={
                workout
                  ? `/exercises?pickFor=${workout.id}`
                  : `/exercises?forDate=${date}`
              }
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/[.06] px-6 py-10 text-center transition-colors hover:bg-primary/10"
            >
              <CirclePlus className="size-14 fill-primary text-background" />
              <span className="text-base font-extrabold text-foreground">
                {workout ? "Add exercise" : "Add workout"}
              </span>
              <span className="text-sm text-muted-foreground">
                {workout
                  ? "No exercises yet - tap to add one."
                  : "No workout logged for this day yet."}
              </span>
            </Link>
          )}
        </>
      )}

      <TodayPill visible={!isToday} onClick={() => changeDate(todayString())} />

      <NoteSheet
        open={noteOpen}
        mode={noteState.mode}
        title={noteState.kind === "day" ? "Day notes" : "Workout notes"}
        placeholder={
          noteState.kind === "day"
            ? "How did today go?"
            : "How did the session go?"
        }
        original={noteState.original}
        draft={noteState.draft}
        onChangeDraft={(draft) => setNoteState((s) => ({ ...s, draft }))}
        onEdit={() => setNoteState((s) => ({ ...s, mode: "edit" }))}
        onClose={closeNoteSheet}
        onSave={saveNote}
      />
    </div>
  )
}

function SummaryCard({
  workout,
  note,
  onOpenDayNote,
  onOpenWorkoutNote,
}: {
  workout: Workout | null
  note: string
  onOpenDayNote: () => void
  onOpenWorkoutNote: () => void
}) {
  // Start / end / duration whenever the workout has a real `started_at`: it
  // is set when a workout is created on its own day. Past workouts logged
  // retroactively start with started_at=null and stay clean.
  const hasTime = !!workout?.started_at
  const lastTime = hasTime && workout ? lastSetTimeOf(workout) : null
  const started =
    hasTime && workout?.started_at ? formatTime(workout.started_at) : null
  const finished = lastTime ? formatTime(lastTime) : null
  const duration =
    hasTime && workout ? formatDuration(workoutDurationSeconds(workout)) : null
  const workoutNote = workout?.notes ?? ""

  return (
    <div className="rounded-lg border border-border bg-foreground/[.02] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {started && <SummaryMeta label="Started" value={started} />}
          {finished && <SummaryMeta label="End" value={finished} />}
          {duration && <SummaryMeta label="Duration" value={duration} />}
          {!!note.trim() && (
            <NoteRow label="Day note" note={note} onClick={onOpenDayNote} />
          )}
          {!!workoutNote.trim() && (
            <NoteRow
              label="Workout note"
              note={workoutNote}
              onClick={onOpenWorkoutNote}
            />
          )}
        </div>
        {workout && <GymEditor workoutId={workout.id} gym={workout.gym} />}
      </div>
    </div>
  )
}

const LABEL_CLS =
  "text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"

function SummaryMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={LABEL_CLS}>{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  )
}

function NoteRow({
  label,
  note,
  onClick,
}: {
  label: string
  note: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-col gap-1 rounded-md py-0.5 text-left transition-opacity hover:opacity-70 active:opacity-55 animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <span className={LABEL_CLS}>{label}</span>
      <NotePreview note={note} className="text-xs font-semibold leading-4" />
    </button>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

/** The multi-select toolbar that stands in for the summary card. */
function SelectionBar({
  count,
  onClear,
  onRemove,
}: {
  count: number
  onClear: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/20 bg-background px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-foreground/10"
      >
        <X className="size-[22px]" />
      </button>
      <span className="flex-1 text-base font-bold">{count} selected</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center gap-1.5 rounded-full border border-destructive bg-destructive/10 px-3.5 py-2 text-sm font-bold text-destructive transition-colors hover:bg-destructive/20"
      >
        <Trash2 className="size-4" />
        Remove
      </button>
    </div>
  )
}

/** Floating "Go to today" chip, shown whenever the viewed day isn't today. */
function TodayPill({
  visible,
  onClick,
}: {
  visible: boolean
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center transition-all duration-150",
        visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-90 opacity-0"
      )}
      aria-hidden={!visible}
    >
      <button
        type="button"
        onClick={onClick}
        tabIndex={visible ? 0 : -1}
        title="Go to today (T)"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-primary bg-card px-4 py-2 text-xs font-bold text-primary shadow-lg shadow-black/35 transition-transform hover:bg-muted active:scale-95",
          visible && "pointer-events-auto"
        )}
      >
        <CalendarDays className="size-3.5" />
        Go to today
      </button>
    </div>
  )
}
