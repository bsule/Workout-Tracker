import type { Exercise } from "@lift/core"

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
