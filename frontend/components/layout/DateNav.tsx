"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { formatDayLabel, shiftDate, todayLocal } from "@/lib/utils"

interface Props {
  date: string
  onChange: (next: string) => void
}

export function DateNav({ date, onChange }: Props) {
  const router = useRouter()
  const today = todayLocal()
  const prev = shiftDate(date, -1)
  const next = shiftDate(date, 1)
  const isToday = date === today

  useEffect(() => {
    router.prefetch(`/workouts/date/${prev}`)
    router.prefetch(`/workouts/date/${next}`)
    if (!isToday) router.prefetch(`/workouts/date/${today}`)
  }, [router, prev, next, isToday, today])

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
        onClick={() => onChange(next)}
        className="rounded-md p-1.5 text-primary hover:bg-white/5 transition-colors"
        aria-label="Next day"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}
