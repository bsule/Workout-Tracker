"use client"

import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { CalendarMap, Category } from "@/types"
import { categoryVar, cn, formatLocalDate, todayLocal } from "@/lib/utils"

interface Props {
  year: number
  month: number // 1-12
  data: CalendarMap
  onPrev: () => void
  onNext: () => void
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function CalendarMonth({ year, month, data, onPrev, onNext }: Props) {
  const firstDay = new Date(year, month - 1, 1)
  // Convert to Mon-start: JS getDay returns 0=Sun..6=Sat. We want Mon=0..Sun=6.
  const startCol = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const today = todayLocal()

  const cells: (number | null)[] = []
  for (let i = 0; i < startCol; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="rounded-lg border border-white/10 bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <button
          onClick={onPrev}
          className="rounded-md p-1.5 text-primary hover:bg-white/5"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-base font-semibold tracking-tight">
          {MONTH_LABELS[month - 1]} {year}
        </div>
        <button
          onClick={onNext}
          className="rounded-md p-1.5 text-primary hover:bg-white/5"
          aria-label="Next month"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="px-1 py-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const iso = formatLocalDate(new Date(year, month - 1, d))
          const cats = data[iso] ?? null
          const isToday = iso === today
          return (
            <Link
              key={i}
              href={`/workouts/date/${iso}`}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-md border text-sm transition-colors",
                isToday
                  ? "border-primary/60 bg-primary/5 text-primary"
                  : "border-transparent text-foreground/85 hover:bg-white/[.04]"
              )}
            >
              <span className="tabular-nums">{d}</span>
              {cats && cats.length > 0 && (
                <DotRow cats={cats} />
              )}
              {cats && cats.length === 0 && (
                <span className="size-1.5 rounded-full bg-white/30" />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function DotRow({ cats }: { cats: Category[] }) {
  const shown = cats.slice(0, 3)
  return (
    <div className="flex items-center gap-1">
      {shown.map((c) => (
        <span
          key={c}
          className="inline-block size-1.5 rounded-full"
          style={{ backgroundColor: categoryVar(c) }}
          aria-label={c}
        />
      ))}
      {cats.length > 3 && (
        <span className="text-[8px] text-muted-foreground">+</span>
      )}
    </div>
  )
}
