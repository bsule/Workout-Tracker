// Fixed month positions prevent a completed swipe from moving or replacing
// the visible native page. VirtualizedList only mounts the nearby months.
export const MONTH_COUNT = 9999 * 12

export function monthIndex(year: number, month: number): number {
  return (year - 1) * 12 + month - 1
}

export function monthAtIndex(index: number) {
  return { year: Math.floor(index / 12) + 1, month: index % 12 + 1 }
}

export function clampMonthIndex(index: number): number {
  return Math.max(0, Math.min(MONTH_COUNT - 1, index))
}

export function monthRowCount(index: number, firstDayOfWeek: 0 | 1): number {
  const { year, month } = monthAtIndex(index)
  const first = new Date(0)
  first.setFullYear(year, month - 1, 1)
  const last = new Date(0)
  last.setFullYear(year, month, 0)
  const leading = (first.getDay() - firstDayOfWeek + 7) % 7
  return Math.ceil((leading + last.getDate()) / 7)
}

export function monthHeightAtOffset(
  offset: number,
  width: number,
  padding: number,
  firstDayOfWeek: 0 | 1
): number {
  if (width <= 0) return padding * 2
  const position = Math.max(0, Math.min(MONTH_COUNT - 1, offset / width))
  const left = Math.floor(position)
  const right = clampMonthIndex(left + 1)
  const progress = position - left
  const rows = monthRowCount(left, firstDayOfWeek) * (1 - progress)
    + monthRowCount(right, firstDayOfWeek) * progress
  return rows * Math.max(0, width - padding * 2) / 7 + padding * 2
}
