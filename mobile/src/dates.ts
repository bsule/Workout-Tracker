/** Local-calendar date helpers. Dates are "YYYY-MM-DD" strings. */

export function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function todayString(): string {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** The date `days` calendar days after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  const dt = new Date(date + "T00:00:00")
  dt.setDate(dt.getDate() + days)
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}
