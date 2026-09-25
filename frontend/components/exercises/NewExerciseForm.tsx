"use client"

import { useState } from "react"
import type { Exercise } from "@/types"
import { Button } from "@/components/ui/button"
import { localApi as api } from "@/lib/store"
import { CategoryChips } from "./CategoryChips"

export const fieldLabelClass =
  "text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground"

export const fieldInputClass =
  "h-11 w-full rounded-md border border-border bg-foreground/[.03] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"

/**
 * Name and category for a new exercise, the web copy of mobile's
 * NewExerciseView / NewExerciseScreen. The button stays disabled until the
 * name has something in it.
 */
export function NewExerciseForm({
  submitLabel,
  placeholder,
  onCreated,
}: {
  submitLabel: string
  placeholder?: string
  onCreated: (ex: Exercise) => void
}) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState<string>("chest")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const ex = await api.createExercise({ name: name.trim(), category })
      onCreated(ex)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create exercise")
      setSubmitting(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
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

      <Button type="submit" size="lg" disabled={!name.trim() || submitting}>
        {submitting ? "Creating…" : submitLabel}
      </Button>
    </form>
  )
}
