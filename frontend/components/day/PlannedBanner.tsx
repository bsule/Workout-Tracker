"use client"

import { todayString } from "@lift/core/dates"
import { cn } from "@/lib/utils"

/**
 * The banner over a planned workout, copied from mobile. Today or a past
 * date: the primary banner with Start. A future date: a quiet one with no
 * button, since a plan starts when its day arrives. `title` overrides the
 * today/past heading (the calendar's detail reads "Planned workout" there).
 */
export function PlannedBanner({
  date,
  onStart,
  title,
}: {
  date: string
  onStart: () => void
  title?: string
}) {
  const isFuture = date > todayString()
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-4",
        isFuture
          ? "border-border bg-foreground/[.02]"
          : "border-primary bg-primary/10"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm font-bold">
          {isFuture
            ? "Planned workout"
            : (title ?? "You have a planned workout today")}
        </div>
        <div className="text-xs text-muted-foreground">
          {isFuture
            ? "Edit targets now; start when the day arrives."
            : "Sets shown are targets, not logged yet."}
        </div>
      </div>
      {!isFuture && (
        <button
          type="button"
          onClick={onStart}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start
        </button>
      )}
    </div>
  )
}
