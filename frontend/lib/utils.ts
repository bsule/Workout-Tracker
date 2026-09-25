import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Category } from "@/types"
import { addDays, todayString, ymd } from "@lift/core/dates"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

/** Format a Date as YYYY-MM-DD using local timezone (never UTC). */
export function formatLocalDate(d: Date): string {
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function todayLocal(): string {
  return todayString()
}

/** True for any local YYYY-MM-DD strictly after today. */
export function isFutureDate(iso: string): boolean {
  return iso > todayLocal()
}

export function parseLocalDate(iso: string): Date {
  // iso = YYYY-MM-DD; build in local TZ to avoid UTC shifts.
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function shiftDate(iso: string, days: number): string {
  return addDays(iso, days)
}

export function formatDayLabel(iso: string): string {
  const today = todayLocal()
  if (iso === today) return "Today"
  const yesterday = shiftDate(today, -1)
  if (iso === yesterday) return "Yesterday"
  const tomorrow = shiftDate(today, 1)
  if (iso === tomorrow) return "Tomorrow"
  return parseLocalDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Workout duration, the mobile rule: "5m", "1h 5m", or null (hide it) when
 *  unknown or not positive. */
export { formatDuration } from "@lift/core/format"

export function categoryVar(category: Category): string {
  return `var(--cat-${category})`
}
