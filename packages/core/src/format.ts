import type { Exercise } from "./types"
import { todayString } from "./dates"

/** "12 workouts (3 days ago)" - the second line of an exercise list row. */
export function formatExerciseSubtitle(ex: Exercise): string {
  const count = ex.workouts_count ?? 0
  const days = ex.last_performed_days_ago ?? null
  if (count === 0) return "0 workouts"
  if (days == null) return `${count} workout${count === 1 ? "" : "s"}`
  return `${count} workout${count === 1 ? "" : "s"} (${formatDays(days)})`
}

function formatDays(d: number): string {
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 7) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) === 1 ? "" : "s"} ago`
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) === 1 ? "" : "s"} ago`
  return "last year"
}

/** An ISO timestamp in the device's locale, or the raw string if unparseable. */
export function formatTimestamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

// The labels below were written for the mobile screens (DayScreen,
// SetLoggerScreen, RestTicker, ExerciseDetailScreen) and moved here unchanged
// so the web app reads the same. Dates are local "YYYY-MM-DD" strings.

/** "Today" / "Yesterday" / "Tomorrow" when applicable; otherwise a long
 *  weekday + month/day, e.g. "Monday, May 6". */
export function labelForDate(d: string): string {
  const t = todayString()
  if (d === t) return "Today"
  const today = new Date(t + "T00:00:00")
  const target = new Date(d + "T00:00:00")
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diffDays === -1) return "Yesterday"
  if (diffDays === 1) return "Tomorrow"
  return target.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

/** The day-note menu item for `date`: "Add a note for today", "Edit
 *  yesterday's note", "Add a note for this day", ... */
export function noteActionLabel(date: string, hasNote: boolean): string {
  const t = todayString()
  if (date === t) return hasNote ? "Edit today's note" : "Add a note for today"
  const named = labelForDate(date)
  if (named === "Yesterday") {
    return hasNote ? "Edit yesterday's note" : "Add a note for yesterday"
  }
  if (named === "Tomorrow") {
    return hasNote ? "Edit tomorrow's note" : "Add a note for tomorrow"
  }
  return hasNote ? "Edit this day's note" : "Add a note for this day"
}

/** "Mon, Sep 22": weekday, month, day, never a year. */
export function niceDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

/** "Sep 22". */
export function shortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

// Records show the year only when it differs from the current year (a PR can
// be years old): dropped the weekday to keep it compact in the rep rows.
export function recordDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = "numeric"
  return dt.toLocaleDateString("en-US", opts)
}

// "Yesterday" / "6 days ago" / "3 weeks ago" for the last-session header. Both
// sides are floored to local midnight so the answer follows calendar days, not
// elapsed hours: a session 20 hours ago still reads "Yesterday".
export function agoLabel(date: string): string {
  const then = new Date(date + "T00:00:00")
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - then.getTime()) / 86400000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return w === 1 ? "1 week ago" : `${w} weeks ago`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return m === 1 ? "1 month ago" : `${m} months ago`
  }
  const y = Math.floor(days / 365)
  return y === 1 ? "1 year ago" : `${y} years ago`
}

/** Compact "Today" / "Yesterday" / "3d ago" / "2w ago" / "4mo ago", for the
 *  exercise detail stats row. */
export function formatRelative(d: string): string {
  const today = new Date(todayString() + "T00:00:00")
  const target = new Date(d + "T00:00:00")
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`
  return `${Math.floor(diff / 30)}mo ago`
}

/** Workout duration: "5m" under an hour, "1h 5m" otherwise, null (hide it)
 *  when unknown or not positive. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Rest between two sets, shown under the set number: "45s", "2m", "2m 5s".
 *  Null for no previous set, 30s or less, or over 30 minutes. */
export function formatRest(prevIso: string | null | undefined, curIso: string): string | null {
  if (!prevIso) return null
  const diff = (Date.parse(curIso) - Date.parse(prevIso)) / 1000
  // Mirror the live ticker's 30-min cap: a gap longer than that isn't rest
  // between sets (e.g. set 1 anchored to another exercise logged hours
  // earlier in the day), so suppress the label instead of showing "1951m".
  if (!Number.isFinite(diff) || diff <= 30 || diff > 1800) return null
  if (diff < 60) return `${Math.round(diff)}s`
  const m = Math.floor(diff / 60)
  const s = Math.round(diff % 60)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

/** Past this the "since last set" ticker hides: the user is presumed not
 *  mid-workout and the line is noise. */
export const TICKER_HIDE_AFTER_S = 1800

/** Whole seconds since `anchorMs`, never negative. */
export function elapsedS(anchorMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - anchorMs) / 1000))
}

/** The "since last set" ticker's count: "45s", then "2m 5s". */
export function formatElapsed(elapsed: number): string {
  if (elapsed < 60) return `${elapsed}s`
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `${m}m ${s}s`
}
