"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePresence } from "@/components/ui/usePresence"
import { useBackdropClose } from "@/components/ui/useBackdropClose"

/**
 * The note popup, the web copy of mobile's NoteSheet: a centered card that
 * reads a note first and edits it on demand.
 *
 * Two modes. "view" shows the saved text read-only behind Close / Edit.
 * "edit" is the textarea itself, with Cancel / Save. Callers that have nothing
 * to read (an empty note, an "Add note" menu item) open at "edit". Save stays
 * disabled until the trimmed text differs from the saved note, and the caller
 * saves the trimmed draft.
 *
 * Controlled like the mobile one: the caller owns `draft` and `mode`.
 */
export function NoteSheet({
  open,
  mode,
  title,
  placeholder,
  original,
  draft,
  onChangeDraft,
  onEdit,
  onClose,
  onSave,
}: {
  open: boolean
  mode: "view" | "edit"
  title: string
  placeholder: string
  original: string
  draft: string
  onChangeDraft: (s: string) => void
  onEdit: () => void
  onClose: () => void
  /** Called after the sheet closes, only when the text changed. */
  onSave: () => void
}) {
  const dirty = draft.trim() !== (original ?? "").trim()
  const backdrop = useBackdropClose(onClose)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // Mount, then flip visible on the next frame so the fade runs; on close,
  // fade out and unmount after it (same timing as ConfirmDialog).
  const { mounted, shown } = usePresence(open)

  useEffect(() => {
    if (!open || mode !== "edit") return
    const f = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(f)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  function handleSave() {
    if (!dirty) return
    onClose()
    onSave()
  }

  if (!mounted) return null
  const viewing = mode === "view"

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm transition-opacity duration-150",
        shown ? "opacity-100" : "opacity-0"
      )}
      {...backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-sm rounded-2xl border border-white/10 bg-card p-5 text-foreground shadow-2xl transition-all duration-150 ease-out",
          shown ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
      >
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {viewing ? (
          <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
            {(original || draft).trim()}
          </div>
        ) : (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => onChangeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave()
            }}
            placeholder={placeholder}
            rows={4}
            className="mt-3 max-h-40 min-h-24 w-full resize-y rounded-lg border border-input bg-background/40 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        )}
        <div className="mt-4 flex gap-2">
          {viewing ? (
            <>
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>
                Close
              </Button>
              <Button type="button" size="lg" className="flex-1" onClick={onEdit}>
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={handleSave}
                disabled={!dirty}
              >
                Save
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
