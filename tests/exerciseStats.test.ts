import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  chartPoints,
  dayValueKg,
  fmtMetric,
  graphEmptyMessage,
  graphHeaderLabel,
  pastDays,
  pickLastSession,
  repRecordRows,
  setNumbersOf,
  weightRepSets,
  xLabelIndices,
  yAxisScale,
} from "@lift/core/exerciseStats"
import { estimateOneRm } from "@lift/core/store/materialize"
import type { ExerciseHistoryDay, HistorySet } from "@lift/core"

// These derivations were lifted verbatim from mobile's SetLoggerScreen
// (GraphPanel, SvgLineChart, SummaryPanel). The expectations pin mobile's
// behavior, which is the reference.

let nextId = 1
function set(
  weight: number | null,
  reps: number | null,
  order: number,
  extra: Partial<HistorySet> = {}
): HistorySet {
  return {
    id: nextId++,
    weight,
    reps,
    distance_m: null,
    distance_unit_display: "m",
    time_seconds: weight == null ? 60 : null,
    is_pr: false,
    was_pr: false,
    is_position_pr: false,
    was_position_pr: false,
    note: "",
    order,
    position: weight == null ? 0 : order + 1,
    estimated_one_rm: estimateOneRm(weight, reps),
    ...extra,
  }
}

function day(date: string, sets: [number | null, number | null][]): ExerciseHistoryDay {
  return { date, note: "", sets: sets.map(([w, r], i) => set(w, r, i)) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("dayValueKg", () => {
  const d = day("2026-09-20", [
    [100, 5],
    [110, 2],
    [90, 8],
    [null, null],
  ])

  it("picks each metric's value and reps", () => {
    expect(dayValueKg(d, "heaviest", 1)).toEqual({ value: 110, reps: 2 })
    expect(dayValueKg(d, "one_rm", 1)).toEqual({
      value: estimateOneRm(110, 2),
      reps: 2,
    })
    expect(dayValueKg(d, "avg_weight", 1)).toEqual({ value: 100, reps: 15 })
    expect(dayValueKg(d, "per_set", 2)).toEqual({ value: 110, reps: 2 })
  })

  it("returns 0 for a missing set position or a cardio-only day", () => {
    expect(dayValueKg(d, "per_set", 4)).toEqual({ value: 0, reps: 0 })
    expect(dayValueKg(day("2026-09-20", [[null, null]]), "heaviest", 1)).toEqual({
      value: 0,
      reps: 0,
    })
  })
})

describe("chartPoints", () => {
  it("sorts oldest first, drops empty days, and rounds in the display unit", () => {
    const days = [
      day("2026-09-22", [[100, 5]]),
      day("2026-09-20", [[null, null]]),
      day("2026-09-18", [[60, 5]]),
    ]
    const kg = chartPoints(days, "heaviest", 1, "kg")
    expect(kg.map((p) => p.date)).toEqual(["2026-09-18", "2026-09-22"])
    const lb = chartPoints(days, "heaviest", 1, "lb")
    expect(lb.map((p) => p.value)).toEqual([132.3, 220.5])
  })
})

describe("graph labels", () => {
  it("names the header and the empty state like mobile", () => {
    expect(graphHeaderLabel("heaviest", 1)).toBe("Heaviest set")
    expect(graphHeaderLabel("per_set", 3)).toBe("3rd set")
    expect(graphHeaderLabel("one_rm", 1)).toBe("1RM")
    expect(graphHeaderLabel("avg_weight", 1)).toBe("Avg Weight")
    expect(graphEmptyMessage("per_set", 2)).toBe("No 2nd sets logged yet.")
    expect(graphEmptyMessage("avg_weight", 1)).toBe("No data for avg weight yet.")
    expect(graphEmptyMessage("one_rm", 1)).toBe("No data for 1rm yet.")
  })

  it("formats numbers", () => {
    expect(fmtMetric(100)).toBe("100")
    expect(fmtMetric(102.46)).toBe("102.5")
    expect(fmtMetric(undefined)).toBe("-")
    expect(fmtMetric(Infinity)).toBe("-")
  })
})

describe("yAxisScale", () => {
  it("uses a round step from a quarter of the span", () => {
    expect(yAxisScale([60, 80])).toMatchObject({ step: 5, yMin: 60, yMax: 80, sections: 4 })
    expect(yAxisScale([60, 100])).toMatchObject({ step: 10, yMin: 60, yMax: 100 })
    expect(yAxisScale([100, 190])).toMatchObject({ step: 25, yMin: 100, yMax: 200 })
    expect(yAxisScale([100, 300])).toMatchObject({ step: 50, yMin: 100, yMax: 300 })
    expect(yAxisScale([100, 700])).toMatchObject({ step: 200, yMin: 0, yMax: 800 })
  })

  it("adds a step when every value is equal, and lists ticks top down", () => {
    const s = yAxisScale([100, 100])
    expect(s).toMatchObject({ step: 5, yMin: 100, yMax: 105, sections: 1 })
    expect(s.ticks).toEqual([105, 100])
  })

  it("floors yMin to the step and never below 0", () => {
    expect(yAxisScale([2, 12]).yMin).toBe(0)
    expect(yAxisScale([63, 77]).yMin).toBe(60)
  })
})

describe("xLabelIndices", () => {
  it("spreads up to 5 labels, first and last included", () => {
    expect(xLabelIndices(1)).toEqual([0])
    expect(xLabelIndices(2)).toEqual([0, 1])
    expect(xLabelIndices(5)).toEqual([0, 1, 2, 3, 4])
    expect(xLabelIndices(11)).toEqual([0, 3, 5, 8, 10])
  })
})

describe("pastDays", () => {
  it("keeps days on or before the current date", () => {
    const days = [day("2026-09-26", []), day("2026-09-24", []), day("2026-09-20", [])]
    expect(pastDays(days, "2026-09-24").map((d) => d.date)).toEqual([
      "2026-09-24",
      "2026-09-20",
    ])
  })
})

describe("pickLastSession", () => {
  const days = [
    day("2026-09-26", [[100, 5]]),
    day("2026-09-24", [[100, 5]]),
    day("2026-09-20", [[100, 5]]),
  ]

  it("skips days after today", () => {
    expect(pickLastSession(days)?.date).toBe("2026-09-24")
  })

  it("skips the excluded date and anything after it", () => {
    expect(pickLastSession(days, "2026-09-24")?.date).toBe("2026-09-20")
    expect(pickLastSession(days, "2026-09-20")).toBeNull()
  })
})

describe("rep records", () => {
  const days = [
    day("2026-09-22", [
      [100, 5],
      [105, 3],
    ]),
    day("2026-09-18", [
      [102.5, 5],
      [80, 10],
      [null, null],
    ]),
  ]
  const wr = weightRepSets(days)

  it("flattens weight x reps sets with their set numbers", () => {
    expect(wr).toHaveLength(4)
    expect(setNumbersOf(wr)).toEqual([1, 2])
  })

  it("keeps the heaviest set per rep count and counts every use", () => {
    const rows = repRecordRows(wr, "weight")
    expect(rows.map((r) => [r.reps, r.weightKg, r.date, r.count])).toEqual([
      [3, 105, "2026-09-22", 1],
      [5, 102.5, "2026-09-18", 2],
      [10, 80, "2026-09-18", 1],
    ])
    expect(rows[0].share).toBe(1)
  })

  it("marks exactly one top 1RM row", () => {
    const rows = repRecordRows(wr, "reps")
    expect(rows.map((r) => r.reps)).toEqual([10, 5, 3])
    const tops = rows.filter((r) => r.isTopOneRm)
    expect(tops).toHaveLength(1)
    const best = Math.max(...rows.map((r) => r.oneRmKg))
    expect(tops[0].oneRmKg).toBe(best)
  })

  it("sorts recent by date, then weight", () => {
    const rows = repRecordRows(wr, "recent")
    expect(rows.map((r) => r.reps)).toEqual([3, 5, 10])
  })

  it("breaks equal-looking weights on reps", () => {
    const tie = weightRepSets([
      day("2026-09-10", [
        [100, 3],
        [100.0001, 5],
      ]),
    ])
    expect(repRecordRows(tie, "weight").map((r) => r.reps)).toEqual([5, 3])
  })
})
