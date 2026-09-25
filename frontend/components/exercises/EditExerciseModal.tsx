"use client"

import { useState } from "react"
import type { Exercise } from "@/types"
import { PopupModal } from "@/components/settings/PopupModal"
import { Button } from "@/components/ui/button"
import { localApi as api } from "@/lib/store"
import { CategoryChips } from "./CategoryChips"
import { fieldInputClass, fieldLabelClass } from "./NewExerciseForm"

/** Rename an exercise or change its category, the web copy of mobile's
 *  EditExerciseScreen. Save stays disabled while the name is empty. */
export function EditExerciseModal({
  exercise,
  onClose,
}: {
  exercise: Exercise | null
  onClose: () => void
}) {
  const [name, setName] = useState(exercise?.name ?? "")
  const [category, setCategory] = useState<string>(exercise?.category ?? "chest")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A different exercise opened: start the form over from it. Done while
  // rendering (React's "adjust state when a prop changes"), not in an effect.
  const [formFor, setFormFor] = useState(exercise)
  if (exercise !== formFor) {
    setFormFor(exercise)
    if (exercise) {
      setName(exercise.name)
      setCategory(exercise.category)
      setError(null)
      setSubmitting(false)
    }
  }

  async function save() {
    if (!exercise) return
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      await api.patchExercise(exercise.id, { name: trimmed, category })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PopupModal
      open={exercise != null}
      title="Edit Exercise"
      onClose={onClose}
      className="max-w-md"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoCorrect="off"
            className={fieldInputClass}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Category</span>
          <CategoryChips selected={category} onSelect={setCategory} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            className="flex-1"
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </PopupModal>
  )
}
