import { describe, expect, it } from "vitest"
import {
  MONTH_COUNT,
  monthAtIndex,
  monthHeightAtOffset,
  monthIndex,
  monthRowCount,
} from "../mobile/src/calendar/monthPaging"

const width = 390
const padding = 8
const rowHeight = (width - padding * 2) / 7
const height = (index: number, progress = 0) =>
  monthHeightAtOffset((index + progress) * width, width, padding, 0)

describe("calendar month paging", () => {
  it("keeps the landing height continuous across August/September in both directions", () => {
    const august = monthIndex(2026, 8)
    const september = monthIndex(2026, 9)
    expect(height(august)).toBeCloseTo(rowHeight * 6 + padding * 2)
    expect(height(september)).toBeCloseTo(rowHeight * 5 + padding * 2)
    expect(height(august, 0.5)).toBeCloseTo(rowHeight * 5.5 + padding * 2)
    expect(height(august, 1 - 0.000001)).toBeCloseTo(height(september), 3)
    expect(height(september, -1 + 0.000001)).toBeCloseTo(height(august), 3)
    // Settling changes the title, not the month position or interpolation range.
    expect(height(august, 1)).toBe(height(september))
  })

  it("fits short February and respects the first weekday and leap years", () => {
    expect(monthRowCount(monthIndex(2026, 2), 0)).toBe(4)
    expect(monthRowCount(monthIndex(2026, 2), 1)).toBe(5)
    expect(monthRowCount(monthIndex(2024, 2), 0)).toBe(5)
    expect(height(monthIndex(2026, 2))).toBeCloseTo(rowHeight * 4 + padding * 2)
  })

  it("pages across the year boundary without rebasing the visible month", () => {
    const december = monthIndex(2026, 12)
    expect(monthAtIndex(december + 1)).toEqual({ year: 2027, month: 1 })
    expect(monthAtIndex(monthIndex(2027, 1) - 1)).toEqual({ year: 2026, month: 12 })
    expect(height(december, 1)).toBe(height(monthIndex(2027, 1)))
  })

  it("clamps overscroll and handles the pre-layout frame without an invalid height", () => {
    expect(monthHeightAtOffset(-width, width, padding, 0)).toBe(height(0))
    expect(monthHeightAtOffset(MONTH_COUNT * width, width, padding, 0)).toBe(height(MONTH_COUNT - 1))
    expect(monthHeightAtOffset(0, 0, padding, 0)).toBe(padding * 2)
  })
})
