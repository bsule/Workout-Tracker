"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { formatDayLabel, shiftDate } from "@/lib/utils"

interface Props {
  date: string
  onChange: (next: string) => void
}

export function DateNav({ date, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(shiftDate(date, -1))}
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
        onClick={() => onChange(shiftDate(date, 1))}
        className="rounded-md p-1.5 text-primary hover:bg-white/5 transition-colors"
        aria-label="Next day"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}
