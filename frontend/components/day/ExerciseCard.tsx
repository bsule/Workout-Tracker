"use client"

import { useRouter } from "next/navigation"
import { CircleCheck } from "lucide-react"
import type { WorkoutExercise } from "@/types"
import { NotePreview } from "@/components/workouts/NotePreview"
import { CategoryPill } from "@/components/day/CategoryPill"
import { SetList } from "@/components/day/SetList"
import { HOLD_DELAY, useHoldPress } from "@/components/day/useHoldPress"
import { loggerHref } from "@/lib/loggerHref"
import { cn } from "@/lib/utils"

/**
 * One exercise on a day, the web copy of mobile's day-view ExerciseRow: name,
 * a two-line preview of the exercise note (display only; the logger edits
 * it), a "N planned" chip when every set is a target, the category pill, and
 * the sets. A click opens the set logger.
 *
 * Selection is optional. With `onLongPress`, holding the card starts a
 * selection, and while `selectionMode` is on a click toggles it instead.
 */
export function ExerciseCard({
  workoutId,
  we,
  selectionMode = false,
  isSelected = false,
  onToggle,
  onLongPress,
  showPlannedChip = true,
}: {
  workoutId: number
  we: WorkoutExercise
  selectionMode?: boolean
  isSelected?: boolean
  onToggle?: () => void
  onLongPress?: () => void
  showPlannedChip?: boolean
}) {
  const router = useRouter()
  const href = loggerHref(workoutId, we.id)
  const setCount = we.sets.length
  const allPlanned = setCount > 0 && we.sets.every((s) => s.is_planned)

  function activate() {
    if (selectionMode) onToggle?.()
    else router.push(href)
  }

  const { holding, handlers } = useHoldPress({
    onPress: activate,
    // Like mobile, a hold does nothing once a selection is running: clicks
    // already toggle.
    onLongPress: selectionMode ? undefined : onLongPress,
  })

  return (
    <div
      role={selectionMode ? "checkbox" : "link"}
      aria-checked={selectionMode ? isSelected : undefined}
      tabIndex={0}
      {...handlers}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          activate()
        }
      }}
      style={{
        transform: holding ? "scale(0.97)" : "scale(1)",
        transition: `transform ${holding ? HOLD_DELAY : 150}ms ease-out`,
        WebkitTouchCallout: "none",
      }}
      className={cn(
        "relative cursor-pointer select-none overflow-hidden rounded-lg border border-foreground/20 bg-background outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary",
        !selectionMode && "hover:border-foreground/35"
      )}
    >
      {/* Selected highlight, faded rather than snapped like mobile's
       *  FadeHighlight. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-10 rounded-[inherit] border border-foreground bg-foreground/[.04] transition-opacity duration-200",
          isSelected ? "opacity-100" : "opacity-0"
        )}
      />
      <div className="flex items-center gap-3 bg-foreground/10 py-3 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-extrabold tracking-tight">
            {we.exercise.name}
          </span>
          <NotePreview
            note={we.note}
            className="text-xs leading-[15px] text-muted-foreground"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showPlannedChip && allPlanned && (
            <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-extrabold tabular-nums tracking-wide text-muted-foreground">
              {setCount} planned
            </span>
          )}
          <CategoryPill category={we.exercise.category} />
          {/* Collapses its width instead of unmounting, so the pill slides
           *  back rather than snapping on deselect. */}
          <span
            aria-hidden
            className={cn(
              "-ml-2 flex overflow-hidden transition-all duration-200",
              isSelected ? "ml-0 w-5 opacity-100" : "w-0 opacity-0"
            )}
          >
            <CircleCheck className="size-5 shrink-0 text-foreground" />
          </span>
        </div>
      </div>

      {setCount === 0 ? (
        <div className="p-4 text-sm font-bold text-primary">
          + Add first set
        </div>
      ) : (
        <div className="border-t border-foreground/20">
          <SetList sets={we.sets} showNotes />
        </div>
      )}
    </div>
  )
}
