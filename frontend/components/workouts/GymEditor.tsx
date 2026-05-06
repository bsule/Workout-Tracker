"use client"

import { Pencil, MapPin, Check, X, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { localApi as api } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Props {
  workoutId: number
  gym: string
  onChange: (gym: string) => void
  /**
   * The most recently used gym across all of the user's workouts. We pass it
   * in so the empty-state shows the last-known gym as a one-click suggestion.
   */
  lastGym?: string | null
}

export function GymEditor({ workoutId, gym, onChange, lastGym }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(gym)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDraft(gym)
  }, [gym])

  useEffect(() => {
    if (!editing) return
    api.listGyms()
      .then((gs) => setHistory(gs.map((g) => g.name)))
      .catch(() => setHistory([]))
  }, [editing])

  // close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDoc)
    return () => window.removeEventListener("mousedown", onDoc)
  }, [open])

  async function save() {
    const trimmed = draft.trim()
    setBusy(true)
    try {
      await api.patchWorkout(workoutId, { gym: trimmed })
      onChange(trimmed)
      setEditing(false)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setDraft(gym)
    setEditing(false)
    setOpen(false)
  }

  if (!editing) {
    if (gym) {
      return (
        <button
          onClick={() => setEditing(true)}
          className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-foreground/80 hover:bg-white/5"
          aria-label="Edit gym"
        >
          <MapPin className="size-3 text-primary/80" />
          <span className="truncate">{gym}</span>
          <Pencil className="size-3 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )
    }
    return (
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
        aria-label="Add gym"
      >
        <MapPin className="size-3" />
        {lastGym ? `+ ${lastGym}` : "+ Add gym"}
      </button>
    )
  }

  // editing
  return (
    <div ref={wrapRef} className="relative inline-flex items-stretch gap-1">
      <div className="relative">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              save()
            } else if (e.key === "Escape") {
              cancel()
            }
          }}
          placeholder="Gym name"
          className="h-7 w-44 rounded-md border border-white/10 bg-white/[.03] px-2 pr-7 text-xs focus:outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-white/5"
          aria-label="Toggle gym list"
        >
          <ChevronDown className="size-3" />
        </button>

        {open && history && history.length > 0 && (
          <ul className="absolute left-0 top-full z-30 mt-1 w-56 max-h-56 overflow-auto rounded-md border border-white/10 bg-popover py-1 shadow-xl">
            {history
              .filter((g) => g.toLowerCase().includes(draft.trim().toLowerCase()))
              .map((g) => (
                <li key={g}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(g)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2 py-1 text-xs text-left hover:bg-white/5",
                      g === draft && "bg-white/5"
                    )}
                  >
                    <MapPin className="size-3 text-muted-foreground" />
                    {g}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-md bg-emerald-500/15 px-1.5 text-emerald-400 hover:bg-emerald-500/25"
        aria-label="Save gym"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="rounded-md px-1.5 text-muted-foreground hover:bg-white/5"
        aria-label="Cancel"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
