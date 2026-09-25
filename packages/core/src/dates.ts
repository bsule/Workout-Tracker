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

/** Every date from `from` to `to`, inclusive. Empty when `from` is later. */
export function enumerateDates(from: string, to: string): string[] {
  if (from > to) return []
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/** One cell of a month grid. Leading and trailing blanks have null fields. */
export interface MonthCell {
  date: string | null
  day: number | null
}

/** The calendar grid for `month` (1-12): blanks before the 1st so rows start
 *  on `firstDayOfWeek`, then every day, then blanks to finish the last week. */
export function buildMonthGrid(
  year: number,
  month: number,
  firstDayOfWeek: 0 | 1
): MonthCell[] {
  // first weekday of the month (0=Sun .. 6=Sat)
  const first = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: MonthCell[] = []
  // Number of leading blanks: how many slots before the 1st when the row
  // starts on `firstDayOfWeek`. (first - firstDayOfWeek + 7) % 7 handles
  // both Sun-start (0) and Mon-start (1).
  const leading = (first - firstDayOfWeek + 7) % 7
  for (let i = 0; i < leading; i++) cells.push({ date: null, day: null })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: ymd(year, month, d), day: d })
  }
  // Complete the final week without adding empty rows.
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
  return cells
}
