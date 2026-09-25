"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronLeft } from "lucide-react"
import { localApi as api } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import type { Category, Exercise } from "@/types"

/** The set logger's Settings tab: rename, recategorize or delete the exercise. */
export function ExerciseSettingsPanel({
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
    // Mobile's wording (ExercisesScreen). Deleting hides the exercise from the
    // list; logged sets stay in history.
    const ok = await confirm({
      title: "Delete exercise?",
      message: `${exercise.name} will be removed. Past sets stay in history.`,
      destructive: true,
      confirmLabel: "Delete",
    })
    if (!ok) return
    setDeleting(true)
    try {
      // No await before navigating: the store call is synchronous, and
      // yielding to React between the mutation and the route change freezes
      // the page (see CLAUDE.md).
      void api.deleteExercise(exercise.id)
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
