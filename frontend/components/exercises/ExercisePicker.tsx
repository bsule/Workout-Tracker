"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { localApi as api } from "@/lib/store"
import { type Category, type Exercise } from "@/types"
import { categoryVar, cn } from "@/lib/utils"
import { CategoryDot } from "./CategoryBadge"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { LoadingBlock } from "@/components/ui/Spinner"

interface Props {
  mode?: "browse" | "pick"
  onPick?: (exercise: Exercise) => void
}

export function ExercisePicker({ mode = "browse", onPick }: Props) {
  const router = useRouter()
  const { labels, categories } = useCategoryStyles()
  const confirm = useConfirm()
  const [exercises, setExercises] = useState<Exercise[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeCats, setActiveCats] = useState<Set<Category>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState("")
  const [savingId, setSavingId] = useState<number | null>(null)

  async function load() {
    try {
      const data = await api.listExercises({ sort: "last_performed" })
      setExercises(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [])

  function startEdit(ex: Exercise) {
    setEditingId(ex.id)
    setDraftName(ex.name)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftName("")
  }

  async function saveEdit(ex: Exercise) {
    const name = draftName.trim()
    if (!name) {
      setError("Exercise name is required.")
      return
    }
    if (name === ex.name) {
      cancelEdit()
      return
    }
    setSavingId(ex.id)
    setError(null)
    try {
      await api.patchExercise(ex.id, { name })
      cancelEdit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update exercise")
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete(ex: Exercise) {
    const used = (ex.workouts_count ?? 0) > 0
    const ok = await confirm({
      title: "Delete this exercise?",
      message: used
        ? `"${ex.name}" will be removed from the exercises list. Past workouts that used it will keep their history.`
        : `"${ex.name}" will be removed from your exercises list.`,
      destructive: true,
      confirmLabel: "Delete",
    })
    if (!ok) return
    setSavingId(ex.id)
    try {
      await api.deleteExercise(ex.id)
      if (editingId === ex.id) cancelEdit()
      setError(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete exercise")
    } finally {
      setSavingId(null)
    }
  }

  const filtered = useMemo(() => {
    if (!exercises) return []
    const q = search.trim().toLowerCase()
    return exercises.filter((e) => {
      if (activeCats.size > 0 && !activeCats.has(e.category)) return false
      if (q && !e.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [exercises, search, activeCats])

  function toggleCat(c: Category) {
    setActiveCats((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link
          href="/exercises/new"
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20"
        >
          <Plus className="size-4" />
          New
        </Link>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Exercise Name"
          className="w-full rounded-md border border-white/10 bg-white/[.02] py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {categories.map((c) => {
          const active = activeCats.has(c)
          return (
            <button
              key={c}
              onClick={() => toggleCat(c)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-white/40 bg-white/15 text-foreground"
                  : "border-white/10 bg-white/[.02] text-foreground/80 hover:bg-white/5"
              )}
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: categoryVar(c) }}
              />
              {labels[c]}
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {exercises === null && <LoadingBlock />}

      {exercises && (
        <ul className="divide-y divide-white/5 rounded-md border border-white/10 bg-card">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No exercises match.
            </li>
          )}
          {filtered.map((e) => (
            <li key={e.id}>
              {mode === "pick" ? (
                <button
                  onClick={() => onPick?.(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[.02]"
                >
                  <ExerciseRowContent ex={e} />
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                  {editingId === e.id ? (
                    <ExerciseRowEditor
                      ex={e}
                      value={draftName}
                      busy={savingId === e.id}
                      onChange={setDraftName}
                      onSave={() => saveEdit(e)}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => router.push(`/exercises/${e.id}`)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <ExerciseRowContent ex={e} />
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                          aria-label={`Edit ${e.name}`}
                          title="Edit exercise"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={savingId === e.id}
                          onClick={() => handleDelete(e)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                          aria-label={`Delete ${e.name}`}
                          title="Delete exercise"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExerciseRowEditor({
  ex,
  value,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  ex: Exercise
  value: string
  busy: boolean
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <CategoryDot category={ex.category} />
      <input
        type="text"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onSave()
          }
          if (event.key === "Escape") onCancel()
        }}
        className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        aria-label={`Name for ${ex.name}`}
        autoFocus
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="rounded p-1.5 text-muted-foreground hover:bg-primary/15 hover:text-primary disabled:opacity-50"
          aria-label={`Save ${ex.name}`}
          title="Save"
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
          aria-label={`Cancel editing ${ex.name}`}
          title="Cancel"
        >
          <X className="size-4" />
        </button>
      </div>
    </>
  )
}

function ExerciseRowContent({ ex }: { ex: Exercise }) {
  const meta = formatLastPerformed(ex)
  return (
    <>
      <CategoryDot category={ex.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{ex.name}</div>
        <div className="text-xs text-muted-foreground">{meta}</div>
      </div>
      {ex.is_custom && (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          custom
        </span>
      )}
    </>
  )
}

function formatLastPerformed(ex: Exercise): string {
  const count = ex.workouts_count ?? 0
  if (count === 0) return "0 workouts"
  const days = ex.last_performed_days_ago
  let when = ""
  if (days == null) when = ""
  else if (days <= 0) when = "today"
  else if (days === 1) when = "yesterday"
  else if (days < 30) when = `${days} days ago`
  else if (days < 365) when = `${Math.floor(days / 30)} months ago`
  else when = "last year"
  const label = count === 1 ? "1 workout" : `${count} workouts`
  return when ? `${label} (${when})` : label
}
