"use client"

import { useState } from "react"
import { FileText } from "lucide-react"
import { NotePreview } from "@/components/workouts/NotePreview"

/** Compact note editor for one exercise on one day. Sits under the exercise
 *  name on its card, so unlike NoteField it carries no uppercase label - a
 *  label under every exercise would drown out the names. */
export function ExerciseNoteField({
  note,
  onSave,
}: {
  note: string
  onSave: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note)

  function save() {
    onSave(draft)
    setEditing(false)
  }

  function cancel() {
    setDraft(note)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(note)
          setEditing(true)
        }}
        className="-mx-1 mt-0.5 flex w-full min-w-0 items-start gap-1 rounded px-1 text-left hover:bg-white/5"
        aria-label={note ? "Edit exercise note" : "Add exercise note"}
      >
        <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        {note ? (
          <NotePreview note={note} className="text-xs text-foreground/80" />
        ) : (
          <span className="truncate text-xs italic text-muted-foreground">
            Add a note for this exercise
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
        placeholder="How this exercise went today"
        rows={2}
        className="w-full resize-y rounded-md border border-white/10 bg-white/[.03] px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
