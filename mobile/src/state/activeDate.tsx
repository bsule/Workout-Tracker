import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

function todayString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface ActiveDateValue {
  date: string
  setDate: (d: string) => void
}

const Ctx = createContext<ActiveDateValue | null>(null)

/**
 * Single source of truth for the date the user is currently viewing. Used by
 * DayScreen (chevron navigation), CalendarScreen (selected day sync), and
 * the global "+" tab so the picker creates / updates the right workout.
 */
export function ActiveDateProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState<string>(todayString())
  return <Ctx.Provider value={{ date, setDate }}>{children}</Ctx.Provider>
}

export function useActiveDate(): string {
  return useContext(Ctx)?.date ?? todayString()
}

/** Read the date AND the setter — used by screens that own the navigation. */
export function useActiveDateAndSetter(): ActiveDateValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("ActiveDateProvider missing")
  return v
}

/**
 * One-way mirror: keep the context in sync with a screen's local date state
 * (e.g. CalendarScreen's selectedDate). DayScreen now uses the context
 * directly via useActiveDateAndSetter, so it doesn't need this.
 */
export function useSyncActiveDate(date: string) {
  const v = useContext(Ctx)
  useEffect(() => {
    if (v && date && v.date !== date) v.setDate(date)
  }, [v, date])
}
