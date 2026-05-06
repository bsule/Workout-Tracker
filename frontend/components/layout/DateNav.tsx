"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { cn, formatDayLabel, isFutureDate, shiftDate, todayLocal } from "@/lib/utils"

interface Props {
  date: string
  onChange: (next: string) => void
}

export function DateNav({ date, onChange }: Props) {
  const router = useRouter()
  const prev = shiftDate(date, -1)
  const next = shiftDate(date, 1)
  const nextDisabled = date >= todayLocal() || isFutureDate(next)

  // Warm Next's route cache for adjacent days so the chevron click skips the
  // network round-trip / RSC payload fetch and feels instant.
  useEffect(() => {
    router.prefetch(`/workouts/date/${prev}`)
    if (!nextDisabled) router.prefetch(`/workouts/date/${next}`)
  }, [router, prev, next, nextDisabled])

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(prev)}
        className="rounded-md p-1.5 text-primary hover:bg-white/5 transition-colors"
        aria-label="Previous day"
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="text-base font-semibold tracking-tight">
        {formatDayLabel(date)}
      </div>
      <button
        type="button"
        onClick={() => nextDisabled || onChange(next)}
        disabled={nextDisabled}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          nextDisabled
            ? "text-white/20 cursor-not-allowed"
            : "text-primary hover:bg-white/5",
        )}
        aria-label="Next day"
        title={nextDisabled ? "Future dates can't be logged" : undefined}
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}
