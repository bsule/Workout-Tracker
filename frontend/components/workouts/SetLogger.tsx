"use client"

import {
  Minus,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  StickyNote,
} from "lucide-react"
import { PrIcon } from "@/components/workouts/PrIcon"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { localApi as api, logPlannedSet } from "@/lib/store"
import { cn } from "@/lib/utils"
import { defaultStep, formatWeight, fromKg, roundForDisplay, toKg } from "@/lib/units"
import {
  useShowPositionPrs,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
import type { WorkoutSet } from "@/types"

interface Props {
  workoutExerciseId: number
  sets: WorkoutSet[]
  /** Used to pre-fill weight/reps when the current day has no sets yet. Weight is in kg (storage unit). */
  fallback?: { weight: number; reps: number } | null
  /** Step in display unit. If omitted, uses 5 lb / 2.5 kg based on user setting. */
  weightStep?: number
  repsStep?: number
  /** When true, sets are saved as planned targets (workout.status === "planned"). */
  isPlanned?: boolean
}

export function SetLogger({
  workoutExerciseId,
  sets,
  fallback,
  weightStep,
  repsStep = 1,
  isPlanned = false,
}: Props) {
  const unit = useWeightUnit()
  const step = weightStep ?? defaultStep(unit)

  // When the user is logging against a planned workout, seed the inputs from
  // the next queued target so Save defaults to the planned values. While
  // authoring targets (isPlanned), or when no targets exist, fall back to the
  // most recent set in the list, then to the prior-session fallback.
  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet
  const initialKg = seed?.weight ?? fallback?.weight ?? 0
  const initialReps = seed?.reps ?? fallback?.reps ?? 8
  // Weight state is in display unit so user sees and edits in their unit.
  const [weight, setWeight] = useState<number>(roundForDisplay(fromKg(initialKg, unit), unit))
  const [reps, setReps] = useState<number>(initialReps)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (weight <= 0 || reps <= 0) {
      setError("Weight and reps must be greater than zero.")
      return
    }
    setSaving(true)
    try {
      if (isPlanned) {
        // Workout is still planned — record this as another target set.
        await api.addPlannedSet(workoutExerciseId, {
          weight: toKg(weight, unit),
          reps,
        })
      } else {
        // If a target was queued for this exercise, log it in place rather
        // than creating a parallel logged-set entry.
        const nextPlanned = sets.find((s) => s.is_planned)
        if (nextPlanned) {
          logPlannedSet(nextPlanned.id, {
            weight: toKg(weight, unit),
            reps,
          })
        } else {
          await api.addSet(workoutExerciseId, {
            weight: toKg(weight, unit),
            reps,
          })
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save set")
    } finally {
      setSaving(false)
    }
  }

  function clear() {
    setWeight(0)
    setReps(0)
    setError(null)
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/10 bg-card/60 p-5 sm:p-6 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <NumericField
            label="Weight"
            unit={unit}
            value={weight}
            step={step}
            min={0}
            onChange={setWeight}
          />
          <NumericField
            label="Reps"
            value={reps}
            step={repsStep}
            min={0}
            onChange={setReps}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            type="button"
            size="lg"
            className="h-12 bg-emerald-500 hover:bg-emerald-500/90 text-emerald-950 text-base font-semibold tracking-wide"
            onClick={save}
            disabled={saving}
          >
            Save
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold tracking-wide"
            onClick={clear}
            disabled={saving}
          >
            Clear
          </Button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <SetList sets={sets} canHit={!isPlanned} />
    </div>
  )
}

function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
}) {
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
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 hover:border-white/20 hover:bg-white/[.06] active:translate-y-px transition-colors"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-5" />
        </button>
        <div className="relative flex-1">
          <input
            type="number"
            inputMode="decimal"
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(Number.isFinite(n) ? n : 0)
            }}
            onFocus={(e) => e.target.select()}
            className="font-mono h-12 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-center text-3xl font-semibold tabular-nums tracking-tight focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(value + step)}
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 hover:border-white/20 hover:bg-white/[.06] active:translate-y-px transition-colors"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  )
}

function SetList({ sets, canHit }: { sets: WorkoutSet[]; canHit: boolean }) {
  if (!sets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-10 text-center text-sm text-muted-foreground">
        No sets logged yet. Log your first set above.
      </div>
    )
  }
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-card/40">
        <div className="grid grid-cols-[1.25rem_2rem_1fr_4rem] items-center gap-x-4 border-b border-white/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          <span />
          <span>Set</span>
          <span className="text-center">Weight</span>
          <span className="text-right">Reps</span>
        </div>
        <div className="divide-y divide-white/5">
          {sets.map((s, i) => (
            <SetRow key={s.id} index={i + 1} set={s} canHit={canHit} />
          ))}
        </div>
      </div>
    </div>
  )
}

function SetRow({
  index,
  set,
  canHit,
}: {
  index: number
  set: WorkoutSet
  canHit: boolean
}) {
  const confirm = useConfirm()
  const unit = useWeightUnit()
  const showPositionPrs = useShowPositionPrs()
  const [editing, setEditing] = useState(false)
  const [weight, setWeight] = useState(roundForDisplay(fromKg(set.weight, unit), unit))
  const [reps, setReps] = useState<number>(set.reps ?? 0)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(set.note)
  const [noteSaving, setNoteSaving] = useState(false)
  // Two-step UX for planned sets: first the user picks Hit / Not hit; only
  // after Not hit do Edit + Delete reveal.
  const [missMode, setMissMode] = useState(false)
  const isPlannedRow = canHit && set.is_planned

  async function save() {
    if (weight <= 0 || reps <= 0) {
      setEditError("Weight and reps must be greater than zero.")
      return
    }
    setEditError(null)
    setBusy(true)
    try {
      await api.updateSet(set.id, { weight: toKg(weight, unit), reps })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    setNoteSaving(true)
    try {
      await api.updateSet(set.id, { note: noteDraft })
      setNoteOpen(false)
    } finally {
      setNoteSaving(false)
    }
  }

  async function hit() {
    if (set.weight == null || set.reps == null) return
    setBusy(true)
    try {
      logPlannedSet(set.id, { weight: set.weight, reps: set.reps })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this set?",
      message: `${formatWeight(set.weight, unit)} ${unit} × ${set.reps ?? 0} reps will be removed.`,
      destructive: true,
      confirmLabel: "Delete",
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteSet(set.id)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="px-4 py-3 bg-white/[.02]">
        <div className="flex items-center gap-2">
          <span className="w-7 text-sm font-semibold tabular-nums text-muted-foreground">
            {index}
          </span>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="font-mono w-24 rounded-md border border-white/10 bg-white/[.04] px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:border-primary/50"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
            className="font-mono w-16 rounded-md border border-white/10 bg-white/[.04] px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:border-primary/50"
          />
          <span className="text-xs text-muted-foreground">reps</span>
          <div className="ml-auto flex gap-1">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md p-1.5 text-emerald-400 hover:bg-emerald-500/10"
              aria-label="Save"
            >
              <Check className="size-4" />
            </button>
            <button
              onClick={() => {
                setEditError(null)
                setEditing(false)
              }}
              disabled={busy}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-white/5"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {editError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {editError}
          </p>
        )}
      </div>
    )
  }

  const hasNote = Boolean(set.note)

  return (
    <div>
      <div className="group relative">
        <div
          className={cn(
            "grid grid-cols-[1.25rem_2rem_1fr_4rem] items-center gap-x-4 px-4 py-3 hover:bg-white/[.02] transition-colors",
            set.is_planned && "opacity-60"
          )}
        >
          {set.is_planned ? (
            <span
              className="size-2 rounded-full border border-dashed border-primary/60"
              aria-label="Target set"
            />
          ) : set.is_pr || set.was_pr ? (
            <PrIcon isPr={set.is_pr} wasPr={set.was_pr} className="size-4" />
          ) : showPositionPrs ? (
            <PrIcon
              isPr={set.is_position_pr}
              wasPr={set.was_position_pr}
              variant="position"
              position={index}
            />
          ) : (
            <PrIcon isPr={false} wasPr={false} className="size-4" />
          )}
          <span className="font-mono text-base font-semibold tabular-nums text-muted-foreground">
            {index}
          </span>
          <span
            className={cn(
              "text-center text-xl font-semibold tabular-nums",
              set.is_planned && "italic text-muted-foreground"
            )}
          >
            <span className="font-mono">{formatWeight(set.weight, unit)}</span>
            <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>
          </span>
          <span
            className={cn(
              "text-right text-xl font-semibold tabular-nums",
              set.is_planned && "italic text-muted-foreground"
            )}
          >
            <span className="font-mono">{set.reps}</span>
          </span>
        </div>
        {hasNote && !noteOpen && (
          <p className="ml-12 px-4 pb-2 whitespace-pre-wrap text-xs italic text-muted-foreground">
            {set.note}
          </p>
        )}
        {isPlannedRow && !missMode && set.weight != null && set.reps != null && (
          <div className="flex items-center justify-end gap-2 px-4 pb-2.5">
            <button
              onClick={hit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Check className="size-3.5" />
              Hit
            </button>
            <button
              onClick={() => setMissMode(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3.5" />
              Not hit
            </button>
          </div>
        )}
        {isPlannedRow && missMode && (
          <div className="flex items-center justify-end gap-2 px-4 pb-2.5">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
            <button
              onClick={() => setMissMode(false)}
              className="rounded-md bg-card/90 p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="Back"
              title="Back"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {!isPlannedRow && (
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <button
              onClick={() => setEditing(true)}
              className="rounded-md bg-card/90 p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="Edit set"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => {
                setNoteDraft(set.note)
                setNoteOpen((v) => !v)
              }}
              className={cn(
                "rounded-md bg-card/90 p-1.5 hover:bg-white/10",
                hasNote ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={hasNote ? "Edit note" : "Add note"}
            >
              <StickyNote className="size-3.5" />
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md bg-card/90 p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label="Delete set"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      {noteOpen && (
        <div className="border-t border-white/5 bg-white/[.015] px-4 py-2.5">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Add a note for this set…"
            rows={2}
            autoFocus
            className="w-full resize-y rounded-md border border-white/10 bg-white/[.03] px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNoteDraft(set.note)
                setNoteOpen(false)
              }}
              disabled={noteSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveNote}
              disabled={noteSaving || noteDraft === set.note}
            >
              {noteSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
