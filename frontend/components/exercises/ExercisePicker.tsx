"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { formatExerciseSubtitle } from "@lift/core/format"
import { listExercisesQ, localApi as api, useStore } from "@/lib/store"
import type { Exercise } from "@/types"
import { ActionMenu } from "@/components/ui/ActionMenu"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { CategoryDot } from "./CategoryBadge"
import { CategoryChips } from "./CategoryChips"
import { EditExerciseModal } from "./EditExerciseModal"
import { NewExerciseForm } from "./NewExerciseForm"

interface Props {
  mode?: "browse" | "pick"
  onPick?: (exercise: Exercise) => void
  /** Pick mode: what to do with an exercise made from the "New" form.
   *  Defaults to `onPick`, since mobile sends a new exercise to the set
   *  logger the same way as a picked one. */
  onCreated?: (exercise: Exercise) => void
  /** Pick mode: told when the in-place "New Exercise" form opens or closes,
   *  so the page can drop its own "Choose Exercise" heading meanwhile. */
  onViewChange?: (view: "list" | "new") => void
}

/**
 * The exercise list (browse) and the exercise picker (pick), the web copy of
 * mobile's ExercisesScreen and ExercisePickerScreen. Reads the store live, so
 * a sync, import, or edit elsewhere shows up without a reload.
 */
export function ExercisePicker({ mode = "browse", onPick, onCreated, onViewChange }: Props) {
  const [view, setViewState] = useState<"list" | "new">("list")
  function setView(next: "list" | "new") {
    setViewState(next)
    onViewChange?.(next)
  }

  if (mode === "pick" && view === "new") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex size-8 items-center justify-center rounded-md hover:bg-foreground/[.06]"
            aria-label="Back to exercises"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h2 className="text-base font-bold">New Exercise</h2>
        </div>
        <NewExerciseForm
          submitLabel="Create exercise"
          placeholder="e.g. Bench Press"
          onCreated={(ex) => (onCreated ?? onPick)?.(ex)}
        />
      </div>
    )
  }

  return <ExerciseList mode={mode} onPick={onPick} onCreateNew={() => setView("new")} />
}

function ExerciseList({
  mode,
  onPick,
  onCreateNew,
}: {
  mode: "browse" | "pick"
  onPick?: (exercise: Exercise) => void
  onCreateNew: () => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState<Exercise | null>(null)
  const snapshot = useStore((s) => s.snapshot)

  const exercises = useMemo(
    () =>
      listExercisesQ({
        q: search.trim() || undefined,
        category: category ?? undefined,
        sort: "last_performed",
      }),
    // The query reads the store directly; the snapshot is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, search, category]
  )

  async function deleteExercise(ex: Exercise) {
    const ok = await confirm({
      title: "Delete exercise?",
      message: `${ex.name} will be removed. Past sets stay in history.`,
      destructive: true,
      confirmLabel: "Delete",
    })
    if (ok) void api.deleteExercise(ex.id)
  }

  const newClass =
    "inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {mode === "pick" ? (
          <button type="button" onClick={onCreateNew} className={newClass}>
            <Plus className="size-4" />
            New
          </button>
        ) : (
          <Link href="/exercises/new" className={newClass}>
            <Plus className="size-4" />
            New
          </Link>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Exercise Name"
          autoCorrect="off"
          autoCapitalize="none"
          className="w-full rounded-md border border-border bg-foreground/[.02] py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* One category at a time; clicking the chosen one again clears it. */}
      <CategoryChips
        selected={category}
        onSelect={(c) => setCategory(category === c ? null : c)}
      />

      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {exercises.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No exercises match.
          </li>
        )}
        {exercises.map((e) => (
          <li key={e.id}>
            {mode === "pick" ? (
              <button
                type="button"
                onClick={() => onPick?.(e)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[.03]"
              >
                <ExerciseRowContent ex={e} />
              </button>
            ) : (
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => router.push(`/exercises/${e.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[.03]"
                >
                  <ExerciseRowContent ex={e} />
                  <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
                </button>
                <ActionMenu
                  ariaLabel={`Actions for ${e.name}`}
                  items={[
                    { label: "Edit", onSelect: () => setEditing(e) },
                    {
                      label: "Delete",
                      destructive: true,
                      onSelect: () => void deleteExercise(e),
                    },
                  ]}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <EditExerciseModal exercise={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ExerciseRowContent({ ex }: { ex: Exercise }) {
  return (
    <>
      <CategoryDot category={ex.category} className="size-3 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{ex.name}</div>
        <div className="text-sm text-muted-foreground">{formatExerciseSubtitle(ex)}</div>
      </div>
    </>
  )
}
