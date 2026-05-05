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
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { WorkoutSet } from "@/types"

interface Props {
  workoutExerciseId: number
  sets: WorkoutSet[]
  weightStep?: number
  repsStep?: number
  onChanged: () => void
}

export function SetLogger({
  workoutExerciseId,
  sets,
  weightStep = 5,
  repsStep = 1,
  onChanged,
}: Props) {
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const [weight, setWeight] = useState<number>(lastSet?.weight ?? 0)
  const [reps, setReps] = useState<number>(lastSet?.reps ?? 8)
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
      await api.addSet(workoutExerciseId, { weight, reps })
      onChanged()
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
            unit="lb"
            value={weight}
            step={weightStep}
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

      <SetList sets={sets} onChanged={onChanged} />
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

function SetList({
  sets,
  onChanged,
}: {
  sets: WorkoutSet[]
  onChanged: () => void
}) {
  if (!sets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-10 text-center text-sm text-muted-foreground">
        No sets logged yet. Log your first set above.
      </div>
    )
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Sets
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {sets.length} logged
        </span>
      </div>
      <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-card/40">
        {sets.map((s, i) => (
          <SetRow key={s.id} index={i + 1} set={s} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function SetRow({
  index,
  set,
  onChanged,
}: {
  index: number
  set: WorkoutSet
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [weight, setWeight] = useState(set.weight)
  const [reps, setReps] = useState(set.reps)
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(Boolean(set.note))
  const [noteDraft, setNoteDraft] = useState(set.note)
  const [noteSaving, setNoteSaving] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.updateSet(set.id, { weight, reps })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (noteDraft === set.note) {
      setNoteOpen(Boolean(noteDraft))
      return
    }
    setNoteSaving(true)
    try {
      await api.updateSet(set.id, { note: noteDraft })
      onChanged()
      setNoteOpen(Boolean(noteDraft))
    } finally {
      setNoteSaving(false)
    }
  }

  async function remove() {
    if (!confirm("Delete this set?")) return
    setBusy(true)
    try {
      await api.deleteSet(set.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-white/[.02]">
        <span className="w-7 text-sm font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        <input
          type="number"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          className="font-mono w-24 rounded-md border border-white/10 bg-white/[.04] px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:border-primary/50"
        />
        <span className="text-xs text-muted-foreground">lb</span>
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
            onClick={() => setEditing(false)}
            disabled={busy}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/5"
            aria-label="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  const hasNote = Boolean(set.note)

  return (
    <div className="group">
      <div className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/[.02] transition-colors">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/5 hover:text-foreground transition-opacity"
          aria-label="Edit set"
        >
          <Pencil className="size-3.5" />
        </button>
        <PrIcon isPr={set.is_pr} wasPr={set.was_pr} />
        <span className="font-mono w-7 text-base font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        <span className="ml-2 flex-1 text-right text-xl font-semibold tabular-nums">
          <span className="font-mono">{set.weight}</span>
          <span className="ml-1 text-xs font-medium text-muted-foreground">lb</span>
        </span>
        <span className="w-20 text-right text-xl font-semibold tabular-nums">
          <span className="font-mono">{set.reps}</span>
          <span className="ml-1 text-xs font-medium text-muted-foreground">reps</span>
        </span>
        <button
          onClick={() => {
            setNoteDraft(set.note)
            setNoteOpen((v) => !v)
          }}
          className={cn(
            "rounded-md p-1 transition-opacity",
            hasNote
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/5 hover:text-foreground"
          )}
          aria-label={hasNote ? "Edit note" : "Add note"}
        >
          <StickyNote className="size-3.5" />
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-md p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive transition-opacity"
          aria-label="Delete set"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {noteOpen && (
        <div className="border-t border-white/5 bg-white/[.015] px-4 py-2.5">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            placeholder="Add a note for this set…"
            rows={2}
            className="w-full resize-y rounded-md border border-white/10 bg-white/[.03] px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{noteSaving ? "Saving…" : "Auto-saves on blur"}</span>
            {noteDraft && (
              <button
                onClick={() => {
                  setNoteDraft("")
                  api.updateSet(set.id, { note: "" }).then(() => {
                    onChanged()
                    setNoteOpen(false)
                  })
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
