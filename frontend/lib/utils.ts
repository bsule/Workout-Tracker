import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Category } from "@/types"

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
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function todayLocal(): string {
  return formatLocalDate(new Date())
}

export function parseLocalDate(iso: string): Date {
  // iso = YYYY-MM-DD; build in local TZ to avoid UTC shifts.
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function shiftDate(iso: string, days: number): string {
  const d = parseLocalDate(iso)
  d.setDate(d.getDate() + days)
  return formatLocalDate(d)
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

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${h}h ${m}m`
}

export const CATEGORY_LABELS: Record<Category, string> = {
  abs: "Abs",
  back: "Back",
  biceps: "Biceps",
  cardio: "Cardio",
  chest: "Chest",
  legs: "Legs",
  shoulders: "Shoulders",
  triceps: "Triceps",
}

export function categoryVar(category: Category): string {
  return `var(--cat-${category})`
}
