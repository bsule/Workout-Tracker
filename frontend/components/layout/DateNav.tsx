"use client"

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { addDays, todayString } from "@lift/core/dates"
import { labelForDate } from "@lift/core/format"
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu"

interface Props {
  date: string
  onChange: (next: string) => void
  /** The date label's menu (mobile: day note, Open calendar, delete). With
   *  no items the label is plain text. */
  menuItems?: ActionMenuItem[]
}

/**
 * The day view's header, copied from mobile: previous / next arrows around
 * "Today", "Yesterday", "Tomorrow" or "Monday, May 6", with a chevron that
 * opens the date menu.
 */
export function DateNav({ date, onChange, menuItems }: Props) {
  const router = useRouter()
  const today = todayString()
  const prev = addDays(date, -1)
  const next = addDays(date, 1)
  const isToday = date === today

  useEffect(() => {
    router.prefetch(`/workouts/date/${prev}`)
    router.prefetch(`/workouts/date/${next}`)
    if (!isToday) router.prefetch(`/workouts/date/${today}`)
  }, [router, prev, next, isToday, today])

  const label = labelForDate(date)

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onChange(prev)}
        className="rounded-md p-1.5 text-primary transition-colors hover:bg-foreground/5"
        aria-label="Previous day"
        title="Previous day (Left arrow)"
      >
        <ChevronLeft className="size-5" />
      </button>
      {menuItems && menuItems.length > 0 ? (
        <ActionMenu
          items={menuItems}
          align="center"
          ariaLabel={`${label}, date menu`}
          className="min-w-0 flex-1 justify-center"
          triggerClassName="min-w-0 justify-center gap-1 rounded-md px-3 py-2 transition-colors hover:bg-foreground/5"
          trigger={
            <>
              <span className="truncate text-base font-bold">{label}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          }
        />
      ) : (
        <div className="min-w-0 flex-1 truncate py-2 text-center text-base font-bold">
          {label}
        </div>
      )}
      <button
        type="button"
        onClick={() => onChange(next)}
        className="rounded-md p-1.5 text-primary transition-colors hover:bg-foreground/5"
        aria-label="Next day"
        title="Next day (Right arrow)"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}
