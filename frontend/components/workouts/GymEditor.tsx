"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Plus } from "lucide-react"
import { localApi as api, listGymsQ } from "@/lib/store"
import { matchGymName } from "@lift/core/workouts"
import { cn } from "@/lib/utils"
import { useBackdropClose } from "@/components/ui/useBackdropClose"

/**
 * The workout's gym on the day view: "📍 {gym}", or a muted "📍 Add gym"
 * when none is set. A click opens the gym picker, the web copy of mobile's
 * GymPickerModal.
 */
export function GymEditor({
  workoutId,
  gym,
}: {
  workoutId: number
  gym: string
}) {
  // Mounted for the fade out as well as while open. Each open is a new
  // session (a fresh key), so the picker always lands on the list with the
  // current gyms, never on a half-typed name.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [session, setSession] = useState(0)
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current)
    },
    []
  )

  function openPicker() {
    if (unmountTimer.current) clearTimeout(unmountTimer.current)
    setSession((n) => n + 1)
    setMounted(true)
    requestAnimationFrame(() => setShown(true))
  }

  const closePicker = useCallback(() => {
    setShown(false)
    if (unmountTimer.current) clearTimeout(unmountTimer.current)
    unmountTimer.current = setTimeout(() => setMounted(false), 180)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="flex min-w-0 shrink items-center gap-1 rounded-md px-1 py-0.5 transition-opacity hover:opacity-70"
        aria-label={gym ? `Gym: ${gym}. Change gym` : "Add gym"}
      >
        <span className="text-sm">📍</span>
        <span
          className={cn(
            "truncate text-sm font-semibold",
            !gym && "font-normal italic text-muted-foreground"
          )}
        >
          {gym || "Add gym"}
        </span>
      </button>
      {mounted && (
        <GymPicker
          key={session}
          shown={shown}
          workoutId={workoutId}
          gym={gym}
          onClose={closePicker}
        />
      )}
    </>
  )
}

/**
 * Modal card titled "Gym". "No gym" clears it, a saved gym applies at once,
 * and "Add gym" opens a name field. A typed name that matches a saved gym in
 * any case picks that gym instead of adding a near-duplicate.
 */
function GymPicker({
  shown,
  workoutId,
  gym,
  onClose,
}: {
  shown: boolean
  workoutId: number
  gym: string
  onClose: () => void
}) {
  // Rows, not names: the list is keyed by gym id, like mobile.
  const [gyms] = useState(() => listGymsQ())
  const gymNames = gyms.map((g) => g.name)
  const [adding, setAdding] = useState(false)
  const [newGym, setNewGym] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const backdrop = useBackdropClose(onClose)

  function startAdding() {
    setAdding(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function cancelAdd() {
    setAdding(false)
    setNewGym("")
  }

  useEffect(() => {
    if (!shown) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (adding) cancelAdd()
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shown, adding, onClose])

  function selectGym(name: string) {
    onClose()
    if (name === gym) return
    api.patchWorkout(workoutId, { gym: name })
  }

  function clearGym() {
    onClose()
    if (gym) api.patchWorkout(workoutId, { gym: "" })
  }

  function commitNew() {
    const name = newGym.trim()
    if (!name) return
    const existing = matchGymName(gymNames, name)
    onClose()
    if (!existing) api.createGym(name)
    api.patchWorkout(workoutId, { gym: existing ?? name })
  }

  const rowCls =
    "flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-base transition-colors"

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm transition-opacity duration-150",
        shown ? "opacity-100" : "opacity-0"
      )}
      {...backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Gym"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[80vh] w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl transition-all duration-150 ease-out",
          shown ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Gym</h2>
          <button
            type="button"
            onClick={adding ? cancelAdd : onClose}
            className="text-base font-semibold text-primary transition-opacity hover:opacity-70"
          >
            {adding ? "Cancel" : "Done"}
          </button>
        </div>

        <div className="flex min-h-0 shrink flex-col overflow-hidden rounded-md border border-border">
          <div
            className={cn(
              "min-h-0 shrink overflow-y-auto",
              adding ? "max-h-[132px]" : "max-h-[264px]"
            )}
          >
            <GymRow label="No gym" muted selected={!gym} first onClick={clearGym} rowCls={rowCls} />
            {gyms.map((g) => (
              <GymRow
                key={g.id ?? `name:${g.name}`}
                label={g.name}
                selected={g.name === gym}
                onClick={() => selectGym(g.name)}
                rowCls={rowCls}
              />
            ))}
          </div>

          {adding ? (
            <div className={cn(rowCls, "border-t border-border")}>
              <input
                ref={inputRef}
                value={newGym}
                onChange={(e) => setNewGym(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitNew()
                  }
                }}
                placeholder="New gym name"
                autoCapitalize="words"
                autoCorrect="off"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={commitNew}
                disabled={!newGym.trim()}
                className="text-base font-semibold text-primary transition-opacity hover:opacity-70 disabled:text-muted-foreground disabled:hover:opacity-100"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startAdding}
              className={cn(rowCls, "justify-start border-t border-border hover:bg-foreground/[.06]")}
            >
              <span className="flex items-center gap-1.5 font-semibold text-primary">
                <Plus className="size-[18px]" />
                Add gym
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function GymRow({
  label,
  selected,
  muted = false,
  first = false,
  onClick,
  rowCls,
}: {
  label: string
  selected: boolean
  muted?: boolean
  first?: boolean
  onClick: () => void
  rowCls: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(rowCls, !first && "border-t border-border", "hover:bg-foreground/[.06]")}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          muted && "text-muted-foreground",
          selected && "font-semibold"
        )}
      >
        {label}
      </span>
      {selected && <Check className="size-[18px] shrink-0 text-primary" />}
    </button>
  )
}
