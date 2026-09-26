"use client"

import {
  Check,
  FileText,
  Minus,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { PrIcon } from "@/components/workouts/PrIcon"
import { RestTicker } from "@/components/workouts/RestTicker"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { NoteSheet } from "@/components/ui/NoteSheet"
import { Button } from "@/components/ui/button"
import {
  localApi as api,
  batchMutations,
  deleteSets,
  estimateOneRm,
  logPlannedSet,
} from "@/lib/store"
import { cn } from "@/lib/utils"
import { defaultStep, formatWeight, fromKg, roundForDisplay, toKg } from "@/lib/units"
import {
  useShowOneRm,
  useShowPositionPrs,
  useShowRestTime,
  useShowTimeSinceLastSet,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
import { lastSetAnchorMs, tickerAnchor } from "@lift/core/restTimer"
import {
  cleanNumericText,
  createdAtForRest,
  deleteSetsTitle,
  nextSetPosition,
  plannedSetTitle,
  restAnchorForEdit,
  restSecondsFrom,
  seedSetForm,
  setFormError,
  setPrBadge,
  setRestLabels,
} from "@lift/core/setLogger"
import { resetTimer, stopTimer, useTimerMark } from "@/lib/restTimerMark"
import type { ExerciseHistoryDay, WorkoutSet } from "@/types"

/** How long a press on a logged row must last to start selecting. */
const HOLD_MS = 250
/** A pointer that moves this far is a scroll or a drag, not a hold. */
const HOLD_SLOP_PX = 8

/** PR gold as text, like mobile's prText token (dark, then light). */
const PR_TEXT = "text-[#e0c050] [.light_&]:text-[#a16207]"

interface Props {
  /** The workout_exercise row, or null on the pending route before the
   *  first save has created it. */
  workoutExerciseId: number | null
  sets: WorkoutSet[]
  /** Cardio stores minutes in `weight` and a level in `reps`, unconverted. */
  isCardio: boolean
  /** The workout is planned: saves add targets instead of logged sets. */
  isPlanned: boolean
  workoutDate: string
  /** This exercise's history, newest first. Read once, to seed the form. */
  history: ExerciseHistoryDay[]
  /** Latest logged set of any other exercise in this workout. Anchors set
   *  1's rest and the ticker before this exercise has a set. */
  prevWorkoutLastSetIso: string | null
  /** Pending route only: creates the workout and exercise row and returns
   *  the row's id. Runs in the same batch as the first set. */
  createTarget?: () => number
  /** Pending route only: called after the first save created the row. */
  onCreated?: (weId: number) => void
  /** Rendered under the set list with the position the next set takes. It
   *  holds still while a set is being edited. */
  renderBelow?: (nextPosition: number) => ReactNode
}

export function SetLogger({
  workoutExerciseId,
  sets,
  isCardio,
  isPlanned,
  workoutDate,
  history,
  prevWorkoutLastSetIso,
  createTarget,
  onCreated,
  renderBelow,
}: Props) {
  const unit = useWeightUnit()
  const confirm = useConfirm()
  const showRestTime = useShowRestTime()
  const showTimeSinceLastSet = useShowTimeSinceLastSet()
  const step = isCardio ? 1 : defaultStep(unit)

  const toDisplay = (stored: number) =>
    isCardio ? stored : roundForDisplay(fromKg(stored, unit), unit)
  const toStored = (v: number) => (isCardio ? v : toKg(v, unit))

  // Seeded once at mount, like mobile: next target, last set, the previous
  // session's top set, then the defaults.
  const [seed] = useState(() =>
    seedSetForm({ sets, isPlanned, history, workoutDate, isCardio })
  )
  const [weight, setWeight] = useState<number>(() => toDisplay(seed.weight))
  const [reps, setReps] = useState<number>(seed.reps)
  const [error, setError] = useState<string | null>(null)

  // Edit mode: Save updates this set instead of adding one.
  const [editingSetId, setEditingSetId] = useState<number | null>(null)
  const [restSec, setRestSec] = useState(0)
  const [restAnchorIso, setRestAnchorIso] = useState<string | null>(null)
  const [originalRestSec, setOriginalRestSec] = useState(0)
  const [frozenPosition, setFrozenPosition] = useState(1)
  // A set deleted underneath the form ends the edit.
  const editingSet = sets.find((s) => s.id === editingSetId) ?? null
  const editing = editingSet != null

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selected = selectedIds.filter((id) => sets.some((s) => s.id === id))
  const selectionMode = selected.length > 0

  const [activePlanned, setActivePlanned] = useState<WorkoutSet | null>(null)
  const [noteSet, setNoteSet] = useState<WorkoutSet | null>(null)
  const [noteDraft, setNoteDraft] = useState("")

  useEffect(() => {
    if (!selectionMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedIds([])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectionMode])

  const mark = useTimerMark()
  const anchorMs = tickerAnchor(
    lastSetAnchorMs({ pendingAddMs: null, sets, fallbackIso: prevWorkoutLastSetIso }),
    mark,
    workoutDate
  )
  const onTimerReset = () => resetTimer(workoutDate)
  const onTimerStop = () => stopTimer(workoutDate)

  const nextPosition = nextSetPosition(sets)
  // Editing a set doesn't change what comes next, so the card holds still.
  const displayPosition = editing ? frozenPosition : nextPosition

  function startEdit(s: WorkoutSet) {
    setEditingSetId(s.id)
    setFrozenPosition(nextPosition)
    setWeight(isCardio ? s.weight ?? 0 : roundForDisplay(fromKg(s.weight ?? 0, unit), unit))
    setReps(s.reps ?? 0)
    const anchor = restAnchorForEdit(sets, s.id, prevWorkoutLastSetIso)
    setRestAnchorIso(anchor)
    const computed = restSecondsFrom(anchor, s.created_at)
    setRestSec(computed)
    setOriginalRestSec(computed)
    setError(null)
  }

  function cancelEdit() {
    setEditingSetId(null)
    setRestAnchorIso(null)
    setError(null)
  }

  function save() {
    setError(null)
    const invalid = setFormError(weight, reps, isCardio)
    if (invalid) {
      setError(invalid)
      return
    }
    const w = toStored(weight)
    const r = reps
    const nowIso = new Date().toISOString()
    try {
      if (editingSet) {
        // Changing the rest moves the set's time to anchor + rest.
        const restChanged = restAnchorIso != null && restSec !== originalRestSec
        const newCreatedAt =
          restChanged && restAnchorIso ? createdAtForRest(restAnchorIso, restSec) : null
        cancelEdit()
        if (editingSet.is_planned) {
          // "Not hit": logs the target with the values the user did.
          logPlannedSet(editingSet.id, { weight: w, reps: r, created_at: nowIso })
        } else {
          api
            .updateSet(editingSet.id, {
              weight: w,
              reps: r,
              ...(newCreatedAt ? { created_at: newCreatedAt } : {}),
            })
            .catch(() => {})
        }
        return
      }
      if (workoutExerciseId == null) {
        // Pending route: the workout and the exercise row are created with
        // the first set, in one batch, so backing out creates nothing.
        if (!createTarget) return
        const weId = batchMutations(() => {
          const id = createTarget()
          if (isPlanned) void api.addPlannedSet(id, { weight: w, reps: r })
          else void api.addSet(id, { weight: w, reps: r, created_at: nowIso })
          return id
        })
        onCreated?.(weId)
        return
      }
      if (isPlanned) {
        void api.addPlannedSet(workoutExerciseId, { weight: w, reps: r })
        return
      }
      // A queued target is logged in place rather than beside a new row.
      const queued = sets.find((s) => s.is_planned)
      if (queued) {
        logPlannedSet(queued.id, { weight: w, reps: r, created_at: nowIso })
      } else {
        void api.addSet(workoutExerciseId, { weight: w, reps: r, created_at: nowIso })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save set")
    }
  }

  function clearOrCancel() {
    if (editing) {
      cancelEdit()
      return
    }
    setWeight(0)
    setReps(0)
    setError(null)
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function onHold(s: WorkoutSet) {
    if (s.is_planned) return
    if (!selected.includes(s.id)) toggleSelected(s.id)
  }

  async function confirmDeleteSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    const ok = await confirm({
      title: deleteSetsTitle(ids.length),
      message: "This can't be undone.",
      cancelLabel: "Cancel",
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    if (editingSetId != null && ids.includes(editingSetId)) cancelEdit()
    setSelectedIds([])
    deleteSets(ids)
  }

  async function deleteOne(s: WorkoutSet) {
    const what = isCardio
      ? `${s.weight ?? "-"} min at Level ${s.reps ?? "-"}`
      : `${formatWeight(s.weight, unit)} ${unit} × ${s.reps ?? 0} reps`
    const ok = await confirm({
      title: "Delete this set?",
      message: `${what} will be removed.`,
      destructive: true,
      confirmLabel: "Delete",
    })
    if (!ok) return
    if (editingSetId === s.id) cancelEdit()
    void api.deleteSet(s.id)
  }

  function openNote(s: WorkoutSet) {
    setNoteSet(s)
    setNoteDraft(s.note ?? "")
  }

  function persistNote() {
    if (!noteSet) return
    api.updateSet(noteSet.id, { note: noteDraft.trim() }).catch(() => {})
  }

  const restShown = editing && showRestTime && restAnchorIso != null
  const selectedCount = selected.length

  return (
    <div className="space-y-6">
      {selectionMode ? (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-card/60 px-3 py-2 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            aria-label="Clear selection"
            className="inline-flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/5"
          >
            <X className="size-5" />
          </button>
          <span className="flex-1 text-sm font-semibold">{selectedCount} selected</span>
          <button
            type="button"
            onClick={confirmDeleteSelected}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20"
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border bg-card/60 p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] transition-colors duration-300 sm:p-6",
            editing ? "border-foreground/80" : "border-white/10"
          )}
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <NumericField
              label={
                isCardio
                  ? editing ? "Time (editing)" : "Time"
                  : editing ? "Weight (editing)" : "Weight"
              }
              unit={isCardio ? "min" : unit}
              value={weight}
              step={step}
              min={0}
              onChange={setWeight}
              allowDecimal
            />
            <NumericField
              label={isCardio ? "Level" : "Reps"}
              value={reps}
              step={1}
              min={0}
              onChange={setReps}
            />
            {restShown && (
              <NumericField
                label="Rest (sec)"
                value={restSec}
                step={5}
                min={0}
                onChange={setRestSec}
              />
            )}
          </div>

          {error && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button
              type="button"
              size="lg"
              className="h-12 bg-emerald-500 text-base font-semibold tracking-wide text-emerald-950 hover:bg-emerald-500/90"
              onClick={save}
            >
              {editing ? "Update" : "Save"}
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-12 bg-primary text-base font-semibold tracking-wide text-primary-foreground hover:bg-primary/90"
              onClick={clearOrCancel}
            >
              {editing ? "Cancel" : "Clear"}
            </Button>
          </div>
        </div>
      )}

      <SetList
        sets={sets}
        isCardio={isCardio}
        prevWorkoutLastSetIso={prevWorkoutLastSetIso}
        selectedIds={selected}
        ticker={
          showTimeSinceLastSet ? (
            <RestTicker anchorMs={anchorMs} onReset={onTimerReset} onStop={onTimerStop} />
          ) : null
        }
        tickerOn={showTimeSinceLastSet && anchorMs != null}
        onHold={onHold}
        onToggle={toggleSelected}
        onPlannedTap={setActivePlanned}
        onEdit={startEdit}
        onNote={openNote}
        onDelete={deleteOne}
      />

      {renderBelow?.(displayPosition)}

      <NoteSheet
        open={noteSet != null}
        // The row already shows the note, so there is nothing to read first.
        mode="edit"
        title="Note"
        placeholder="Add a note for this set…"
        original={noteSet?.note ?? ""}
        draft={noteDraft}
        onChangeDraft={setNoteDraft}
        onEdit={() => {}}
        onClose={() => setNoteSet(null)}
        onSave={persistNote}
      />

      <PlannedSetDialog
        set={activePlanned}
        title={activePlanned ? plannedSetTitle(activePlanned, unit, isCardio) : ""}
        onClose={() => setActivePlanned(null)}
        onHit={(s) => {
          setActivePlanned(null)
          if (s.weight == null || s.reps == null) return
          logPlannedSet(s.id, {
            weight: s.weight,
            reps: s.reps,
            created_at: new Date().toISOString(),
          })
        }}
        onNotHit={(s) => {
          setActivePlanned(null)
          startEdit(s)
        }}
        onDelete={(s) => {
          setActivePlanned(null)
          if (editingSetId === s.id) cancelEdit()
          void api.deleteSet(s.id)
        }}
      />
    </div>
  )
}

/**
 * A number input with +/- steppers. The text is buffered locally, so "" and
 * "1." survive while typing instead of snapping back to "0" and "1". It
 * resyncs from `value` only when that differs from what the text parses to
 * (a stepper click, an edit loading a set).
 */
function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
  allowDecimal = false,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
  allowDecimal?: boolean
}) {
  const [text, setText] = useState(String(value))
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    const parsed = Number(text)
    if (!Number.isFinite(parsed) || parsed !== value) setText(String(value))
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </label>
        {unit && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {unit}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 transition-colors hover:border-white/20 hover:bg-white/[.06] active:translate-y-px"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-5" />
        </button>
        <input
          type="text"
          inputMode={allowDecimal ? "decimal" : "numeric"}
          aria-label={label}
          value={text}
          onChange={(e) => {
            const cleaned = cleanNumericText(e.target.value, allowDecimal)
            setText(cleaned)
            const n = Number(cleaned)
            if (Number.isFinite(n)) onChange(n)
          }}
          onFocus={(e) => e.target.select()}
          className="h-12 w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.03] px-3 text-center font-mono text-3xl font-semibold tabular-nums tracking-tight focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={() => onChange(value + step)}
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 transition-colors hover:border-white/20 hover:bg-white/[.06] active:translate-y-px"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  )
}

function SetList({
  sets,
  isCardio,
  prevWorkoutLastSetIso,
  selectedIds,
  ticker,
  tickerOn,
  onHold,
  onToggle,
  onPlannedTap,
  onEdit,
  onNote,
  onDelete,
}: {
  sets: WorkoutSet[]
  isCardio: boolean
  prevWorkoutLastSetIso: string | null
  selectedIds: number[]
  ticker: ReactNode
  /** Whether the ticker line is likely on screen, for the card's corners. */
  tickerOn: boolean
  onHold: (s: WorkoutSet) => void
  onToggle: (id: number) => void
  onPlannedTap: (s: WorkoutSet) => void
  onEdit: (s: WorkoutSet) => void
  onNote: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const showRestTime = useShowRestTime()
  const selectionMode = selectedIds.length > 0

  if (!sets.length) {
    return (
      <div>
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-10 text-center text-sm text-muted-foreground">
          No sets logged yet. Log your first set above.
        </div>
        {ticker}
      </div>
    )
  }

  const restLabels = setRestLabels(sets, prevWorkoutLastSetIso)

  // No overflow clip on the card: the ticker's menu drops below it. The rows
  // box rounds its own corners instead.
  return (
    <div className="rounded-2xl border border-white/10 bg-card/40">
      <div
        className={cn(
          "divide-y divide-white/5 overflow-hidden rounded-t-2xl",
          !tickerOn && "rounded-b-2xl"
        )}
      >
        {sets.map((s, i) => (
          <SetRow
            key={s.id}
            index={i + 1}
            set={s}
            isCardio={isCardio}
            restLabel={showRestTime && !s.is_planned ? restLabels[i] : null}
            selected={selectedIds.includes(s.id)}
            selectionMode={selectionMode}
            onHold={onHold}
            onToggle={onToggle}
            onPlannedTap={onPlannedTap}
            onEdit={onEdit}
            onNote={onNote}
            onDelete={onDelete}
          />
        ))}
      </div>
      {ticker}
    </div>
  )
}

function SetRow({
  index,
  set: s,
  isCardio,
  restLabel,
  selected,
  selectionMode,
  onHold,
  onToggle,
  onPlannedTap,
  onEdit,
  onNote,
  onDelete,
}: {
  index: number
  set: WorkoutSet
  isCardio: boolean
  restLabel: string | null
  selected: boolean
  selectionMode: boolean
  onHold: (s: WorkoutSet) => void
  onToggle: (id: number) => void
  onPlannedTap: (s: WorkoutSet) => void
  onEdit: (s: WorkoutSet) => void
  onNote: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const unit = useWeightUnit()
  const showPositionPrs = useShowPositionPrs()
  const showOneRm = useShowOneRm()
  const planned = !!s.is_planned
  const badge = setPrBadge(s, showPositionPrs)
  const oneRm = !planned ? estimateOneRm(s.weight, s.reps) : 0

  // Hold to select, with mouse or touch. The click that ends a hold is
  // swallowed so it doesn't toggle the row straight back.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)

  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    holdStart.current = null
  }

  useEffect(() => clearHold, [])

  function onPointerDown(e: React.PointerEvent) {
    if (planned || e.button !== 0) return
    held.current = false
    clearHold()
    holdStart.current = { x: e.clientX, y: e.clientY }
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      held.current = true
      onHold(s)
    }, HOLD_MS)
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = holdStart.current
    if (!start) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP_PX) clearHold()
  }

  function onClick() {
    if (held.current) {
      held.current = false
      return
    }
    if (planned) {
      onPlannedTap(s)
      return
    }
    if (selectionMode) onToggle(s.id)
  }

  const clickable = planned || selectionMode

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={selectionMode && !planned ? selected : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onPointerLeave={clearHold}
      onContextMenu={(e) => {
        // A touch hold would otherwise open the browser's menu.
        if (held.current || selectionMode) e.preventDefault()
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!clickable || (e.key !== "Enter" && e.key !== " ")) return
        e.preventDefault()
        onClick()
      }}
      className={cn(
        "group relative flex min-h-12 select-none flex-col justify-center gap-1 px-4 py-2.5 transition-colors [-webkit-touch-callout:none]",
        clickable && "cursor-pointer",
        selected
          ? "bg-white/10"
          : planned
            ? "bg-white/[.015] hover:bg-white/[.03]"
            : "hover:bg-white/[.02]"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex w-7 shrink-0 items-center">
          {badge && (
            <PrIcon
              isPr={!badge.historical}
              wasPr={badge.historical}
              variant={badge.kind}
              position={index}
            />
          )}
        </span>
        <span className="flex w-9 shrink-0 flex-col leading-tight">
          <span
            className={cn(
              "text-base font-bold tabular-nums",
              s.is_pr ? PR_TEXT : "text-muted-foreground"
            )}
          >
            {selected ? <Check className="size-4" aria-label="Selected" /> : index}
          </span>
          {restLabel && (
            <span className="whitespace-nowrap text-[9px] font-medium tabular-nums text-muted-foreground">
              {restLabel}
            </span>
          )}
        </span>
        <span
          className={cn(
            "flex-1 text-center text-lg font-bold tabular-nums",
            planned && "italic text-muted-foreground"
          )}
        >
          {isCardio ? s.weight ?? "-" : formatWeight(s.weight, unit)}{" "}
          <span className="text-[11px] font-normal not-italic text-muted-foreground">
            {isCardio ? "min" : unit}
          </span>
        </span>
        <span
          className={cn(
            "min-w-12 whitespace-nowrap text-right text-lg font-bold tabular-nums",
            planned && "italic text-muted-foreground"
          )}
        >
          {isCardio ? `Lvl ${s.reps ?? "-"}` : s.reps ?? "-"}
        </span>
        {!isCardio && !planned && showOneRm && oneRm > 0 ? (
          <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-muted-foreground">
            {formatWeight(oneRm, unit)} 1RM
          </span>
        ) : planned ? (
          <span className="text-[11px] font-semibold italic text-muted-foreground">planned</span>
        ) : null}
      </div>

      {!planned && s.note.trim() && (
        <p className="ml-10 flex items-start gap-1.5 pr-2 text-[11.5px] italic leading-4 text-muted-foreground">
          <FileText className="mt-0.5 size-3 shrink-0" />
          <span className="whitespace-pre-wrap">{s.note}</span>
        </p>
      )}

      {!planned && !selectionMode && (
        <div
          className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onEdit(s)}
            className="rounded-md bg-card/90 p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            aria-label="Edit set"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNote(s)}
            className={cn(
              "rounded-md bg-card/90 p-1.5 hover:bg-white/10",
              s.note ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={s.note ? "Edit note" : "Add note"}
          >
            <StickyNote className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(s)}
            className="rounded-md bg-card/90 p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            aria-label="Delete set"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Tap-to-act popup for a planned set, mobile's PlannedSetActionsModal. Hit
 * logs it at the target, Not hit loads the target into the form to edit, and
 * Delete removes it without a confirm.
 */
function PlannedSetDialog({
  set,
  title,
  onClose,
  onHit,
  onNotHit,
  onDelete,
}: {
  set: WorkoutSet | null
  title: string
  onClose: () => void
  onHit: (s: WorkoutSet) => void
  onNotHit: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const open = set != null
  // Keep the last set and title through the fade-out.
  const [shownSet, setShownSet] = useState<WorkoutSet | null>(set)
  const [shownTitle, setShownTitle] = useState(title)
  if (set && (set !== shownSet || title !== shownTitle)) {
    setShownSet(set)
    setShownTitle(title)
  }
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  if (open && !mounted) setMounted(true)
  if (!open && visible) setVisible(false)

  useEffect(() => {
    if (open) {
      const f = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(f)
    }
    const t = setTimeout(() => setMounted(false), 180)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!mounted || !shownSet) return null
  const s = shownSet

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm transition-opacity duration-150",
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={shownTitle}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-xs rounded-2xl border border-white/10 bg-card p-5 text-foreground shadow-2xl transition-all duration-150 ease-out",
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
      >
        <h2 className="text-center text-base font-semibold tabular-nums tracking-tight">
          {shownTitle}
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onHit(s)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-secondary/30 bg-secondary/10 py-3 text-sm font-semibold text-secondary transition-colors hover:bg-secondary/20"
          >
            <Check className="size-4" />
            Hit
          </button>
          <button
            type="button"
            onClick={() => onNotHit(s)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.03] py-3 text-sm font-semibold text-foreground transition-colors hover:bg-white/[.07]"
          >
            <Pencil className="size-4" />
            Not hit
          </button>
          <button
            type="button"
            onClick={() => onDelete(s)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 py-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20"
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
