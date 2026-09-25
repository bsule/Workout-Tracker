"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo } from "react"
import { buildMonthGrid, todayString } from "@lift/core/dates"
import type { CalendarMap, Category } from "@/types"
import { categoryVar, cn } from "@/lib/utils"
import { useSettings } from "@/components/settings/SettingsProvider"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"

interface Props {
  year: number
  month: number // 1-12
  data: CalendarMap
  plannedDates?: string[]
  selectedDate: string
  onSelect: (date: string) => void
  onPrev: () => void
  onNext: () => void
  /** The month title: jumps back to the current month. */
  onToday: () => void
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const WEEKDAYS_SUN = ["S", "M", "T", "W", "T", "F", "S"]
const WEEKDAYS_MON = ["M", "T", "W", "T", "F", "S", "S"]

/**
 * The month grid, the web copy of mobile's CalendarScreen grid. A click
 * selects a day (the page shows it under the grid) instead of navigating.
 */
export function CalendarMonth({
  year,
  month,
  data,
  plannedDates,
  selectedDate,
  onSelect,
  onPrev,
  onNext,
  onToday,
}: Props) {
  const { settings } = useSettings()
  const firstDayOfWeek = settings.first_day_of_week === 1 ? 1 : 0
  const labels = firstDayOfWeek === 1 ? WEEKDAYS_MON : WEEKDAYS_SUN
  const cells = useMemo(
    () => buildMonthGrid(year, month, firstDayOfWeek),
    [year, month, firstDayOfWeek]
  )
  const planned = useMemo(() => new Set(plannedDates ?? []), [plannedDates])
  const today = todayString()

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between gap-2 py-2">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md p-1.5 text-primary transition-colors hover:bg-foreground/5"
          aria-label="Previous month"
          title="Previous month (Page Up)"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="flex-1 rounded-md py-1.5 text-center text-base font-bold transition-opacity hover:opacity-70"
          title="Go to this month"
        >
          {MONTH_LABELS[month - 1]} {year}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md p-1.5 text-primary transition-colors hover:bg-foreground/5"
          aria-label="Next month"
          title="Next month (Page Down)"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border px-2 pb-2">
        {labels.map((d, i) => (
          <div
            key={i}
            className="text-center text-xs font-bold tracking-wider text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 p-2">
        {cells.map((cell, i) =>
          cell.date ? (
            <DayCell
              key={cell.date}
              date={cell.date}
              day={cell.day!}
              cats={data[cell.date]}
              planned={planned.has(cell.date)}
              isToday={cell.date === today}
              isSelected={cell.date === selectedDate}
              onSelect={onSelect}
            />
          ) : (
            <div key={`blank-${i}`} className="aspect-square" />
          )
        )}
      </div>
    </div>
  )
}

function DayCell({
  date,
  day,
  cats,
  planned,
  isToday,
  isSelected,
  onSelect,
}: {
  date: string
  day: number
  cats: Category[] | undefined
  planned: boolean
  isToday: boolean
  isSelected: boolean
  onSelect: (date: string) => void
}) {
  const { labels } = useCategoryStyles()
  const isPlannedOnly = planned && (!cats || cats.length === 0)
  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      aria-pressed={isSelected}
      aria-label={new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      className="aspect-square p-[3px] outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-primary"
    >
      <span
        className={cn(
          "flex size-full flex-col items-center justify-start rounded-md border border-transparent pt-1.5 transition-colors",
          !isSelected && !isToday && "hover:bg-foreground/[.04]",
          isToday && "border-foreground/20 bg-foreground/5",
          isSelected && "border-foreground bg-foreground/10"
        )}
      >
        <span
          className={cn(
            "text-sm font-semibold tabular-nums sm:text-base",
            (isToday || isSelected) && "font-extrabold"
          )}
        >
          {day}
        </span>
        <span className="mt-1 flex min-h-1.5 items-center gap-[3px]">
          {cats && cats.length > 0 ? (
            cats.slice(0, 4).map((c) => (
              <span
                key={c}
                className="size-[5px] rounded-full"
                style={{ backgroundColor: categoryVar(c) }}
                aria-label={labels[c] ?? c}
              />
            ))
          ) : isPlannedOnly ? (
            <span
              className="size-1.5 rounded-full border border-dashed border-muted-foreground"
              aria-label="Planned"
            />
          ) : null}
        </span>
      </span>
    </button>
  )
}
