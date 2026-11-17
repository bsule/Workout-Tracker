import { describe, expect, it } from "vitest"
import {
  CARDIO_METRIC_OPTIONS,
  CARDIO_SORTS,
  METRIC_OPTIONS,
  REP_SORTS,
  cardioChartPoints,
  cardioDayValue,
  cardioRecordRows,
  chartPoints,
  defaultGraphMetric,
  graphDeltaText,
  graphEmptyMessage,
  graphHeaderLabel,
  graphMetricFor,
  graphMetricLabel,
  graphMetricOptions,
  graphPointDetail,
  graphPoints,
  graphValueParts,
  recordRows,
  recordSortFor,
  recordSorts,
  recordsSectionTitle,
  repRecordRows,
  showAllRecordsLabel,
  weightRepSets,
  fmtMetric,
  type Metric,
} from "@lift/core/exerciseStats"
import {
  acceptClockText,
  formatCardioTime,
  lastSessionChipParts,
  lastSessionSummary,
  plannedSetTitle,
  setValueText,
  topRecordsLabel,
} from "@lift/core/setLogger"
import { estimateOneRm } from "@lift/core/store/materialize"
import type { ExerciseHistoryDay, HistorySet } from "@lift/core"

// Cardio (by category) stores minutes in `weight` and a level in `reps`, with
// no kg/lb conversion. These pin how every set-logger tab shows it, and that
// weight exercises show exactly what they did before.

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
    time_seconds: null,
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

describe("formatCardioTime", () => {
  it("shows minutes as a clock", () => {
    expect(formatCardioTime(20)).toBe("20:00")
    expect(formatCardioTime(20.5)).toBe("20:30")
    expect(formatCardioTime(65)).toBe("1:05:00")
    expect(formatCardioTime(0.25)).toBe("0:15")
    expect(formatCardioTime(20.3)).toBe("20:18")
  })

  it("signs a change", () => {
    expect(formatCardioTime(5, true)).toBe("+5:00")
    expect(formatCardioTime(-2.5, true)).toBe("-2:30")
    expect(formatCardioTime(0, true)).toBe("0:00")
    expect(formatCardioTime(65, true)).toBe("+1:05:00")
  })
})

describe("cardio set text", () => {
  it("rows, chips, the collapsed line and the planned title use the clock", () => {
    expect(setValueText({ weight: 20.5, reps: 5 }, "kg", true)).toEqual({
      amount: "20:30",
      unit: "",
      reps: "Lvl 5",
    })
    expect(lastSessionChipParts({ weight: 65, reps: 3 }, "lb", true)).toEqual({
      amount: "1:05:00",
      reps: "Lvl 3",
    })
    expect(
      lastSessionSummary(
        [
          { weight: 20, reps: 5 },
          { weight: 20.5, reps: 6 },
        ],
        "lb",
        true
      )
    ).toBe("20:00×Lvl 5   20:30×Lvl 6")
    expect(plannedSetTitle({ weight: 20.5, reps: 5 }, "lb", true)).toBe("20:30 × Lvl 5")
    expect(plannedSetTitle({ weight: null, reps: 5 }, "lb", true)).toBe("- × Lvl 5")
    expect(topRecordsLabel(true)).toBe("Longest times")
  })

  it("leaves weight sets exactly as they were", () => {
    expect(setValueText({ weight: 100, reps: 5 }, "lb", false)).toEqual({
      amount: "220.5",
      unit: "lb",
      reps: "5",
    })
    expect(setValueText({ weight: 100, reps: 5 }, "kg", false)).toEqual({
      amount: "100",
      unit: "kg",
      reps: "5",
    })
    expect(lastSessionChipParts({ weight: 100, reps: 5 }, "lb", false)).toEqual({
      amount: "220.5",
      reps: "5",
    })
    expect(
      lastSessionSummary(
        [
          { weight: 100, reps: 5 },
          { weight: 100, reps: 4 },
        ],
        "kg"
      )
    ).toBe("100×5   100×4")
    expect(plannedSetTitle({ weight: 100, reps: 5 }, "kg", false)).toBe("100 kg × 5")
    expect(topRecordsLabel(false)).toBe("Top weights")
  })
})

describe("cardio graph", () => {
  const days = [
    day("2026-09-20", [
      [20, 5],
      [10.5, 8],
    ]),
    day("2026-09-10", [[25, 4]]),
    day("2026-09-01", [[null, null]]),
  ]

  it("offers time and level metrics, Total time first", () => {
    expect(graphMetricOptions(true)).toBe(CARDIO_METRIC_OPTIONS)
    expect(CARDIO_METRIC_OPTIONS.map((o) => o.label)).toEqual(["Total time", "Longest", "Top level"])
    expect(defaultGraphMetric(true)).toBe("total_time")
    expect(graphMetricFor("per_set", true)).toBe("total_time")
    expect(graphMetricFor("longest", true)).toBe("longest")
    expect(graphMetricFor("longest", false)).toBe("per_set")
  })

  it("derives each day's value", () => {
    expect(cardioDayValue(days[0], "total_time")).toEqual({ value: 30.5, reps: 0 })
    expect(cardioDayValue(days[0], "longest")).toEqual({ value: 20, reps: 5 })
    expect(cardioDayValue(days[0], "top_level")).toEqual({ value: 8, reps: 0 })
    expect(cardioDayValue(days[2], "total_time")).toEqual({ value: 0, reps: 0 })
  })

  it("counts an imported set's time_seconds when it has no weight", () => {
    const d = { date: "2026-09-05", note: "", sets: [set(null, null, 0, { time_seconds: 1530 })] }
    expect(cardioDayValue(d, "total_time").value).toBe(25.5)
    expect(cardioDayValue(d, "top_level").value).toBe(0)
  })

  it("plots oldest first and drops empty days", () => {
    expect(cardioChartPoints(days, "total_time")).toEqual([
      { date: "2026-09-10", value: 25, reps: 0 },
      { date: "2026-09-20", value: 30.5, reps: 0 },
    ])
    expect(graphPoints(days, "top_level", 1, "lb").map((p) => p.value)).toEqual([4, 8])
  })

  it("labels values, deltas, headers and empty states by metric", () => {
    expect(graphValueParts(30.5, "total_time", "lb")).toEqual({ value: "30:30", unit: "" })
    expect(graphValueParts(65, "longest", "lb")).toEqual({ value: "1:05:00", unit: "" })
    expect(graphValueParts(8, "top_level", "lb")).toEqual({ value: "8", unit: "level" })
    expect(graphValueParts(undefined, "total_time", "lb")).toEqual({ value: "-", unit: "" })
    expect(graphDeltaText(5, "total_time")).toBe("+5:00")
    expect(graphDeltaText(-0.5, "longest")).toBe("-0:30")
    expect(graphDeltaText(2, "top_level")).toBe("+2")
    expect(graphHeaderLabel("total_time", 1)).toBe("Total time")
    expect(graphHeaderLabel("longest", 1)).toBe("Longest set")
    expect(graphHeaderLabel("top_level", 1)).toBe("Top level")
    expect(graphMetricLabel("longest")).toBe("Longest")
    expect(graphEmptyMessage("total_time", 1)).toBe("No time logged yet.")
    expect(graphEmptyMessage("top_level", 1)).toBe("No levels logged yet.")
    expect(graphPointDetail({ date: "x", value: 20, reps: 5 }, "longest")).toBe("× Lvl 5")
    expect(graphPointDetail({ date: "x", value: 20, reps: 0 }, "total_time")).toBeNull()
  })

  it("leaves the weight graph exactly as it was", () => {
    const w = [
      day("2026-09-20", [
        [100, 5],
        [90, 8],
      ]),
      day("2026-09-10", [[95, 5]]),
    ]
    expect(graphMetricOptions(false)).toBe(METRIC_OPTIONS)
    expect(defaultGraphMetric(false)).toBe("per_set")
    for (const m of ["per_set", "heaviest", "one_rm", "avg_weight"] as Metric[]) {
      expect(graphPoints(w, m, 1, "lb")).toEqual(chartPoints(w, m, 1, "lb"))
      expect(graphValueParts(102.5, m, "lb")).toEqual({ value: fmtMetric(102.5), unit: "lb" })
      expect(graphValueParts(undefined, m, "kg")).toEqual({ value: "-", unit: "kg" })
      expect(graphMetricLabel(m)).toBe(METRIC_OPTIONS.find((o) => o.value === m)!.label)
    }
    expect(graphDeltaText(5, "heaviest")).toBe("+5")
    expect(graphDeltaText(-2.5, "heaviest")).toBe("-2.5")
    expect(graphDeltaText(0, "one_rm")).toBe("0")
    expect(graphPointDetail({ date: "x", value: 100, reps: 5 }, "heaviest")).toBe("× 5 reps")
    expect(graphPointDetail({ date: "x", value: 100, reps: 0 }, "avg_weight")).toBeNull()
    expect(graphHeaderLabel("heaviest", 1)).toBe("Heaviest set")
    expect(graphHeaderLabel("per_set", 2)).toBe("2nd set")
    expect(graphHeaderLabel("one_rm", 1)).toBe("1RM")
    expect(graphEmptyMessage("per_set", 3)).toBe("No 3rd sets logged yet.")
    expect(graphEmptyMessage("avg_weight", 1)).toBe("No data for avg weight yet.")
  })
})

describe("cardio records", () => {
  // Level 5 twice (20:00 and 30:00), level 8 once (10:30), level 4 once (30:00).
  const days = [
    day("2026-09-20", [
      [20, 5],
      [10.5, 8],
    ]),
    day("2026-09-15", [[30, 4]]),
    day("2026-09-10", [[30, 5]]),
  ]
  const sets = weightRepSets(days)

  it("keeps the longest time per level and counts every use", () => {
    const rows = cardioRecordRows(sets, "longest")
    expect(rows.map((r) => [r.reps, r.weightKg, r.date, r.count])).toEqual([
      [5, 30, "2026-09-10", 2],
      [4, 30, "2026-09-15", 1],
      [8, 10.5, "2026-09-20", 1],
    ])
    expect(rows.every((r) => r.oneRmKg === 0)).toBe(true)
  })

  it("marks the single longest time, ties to the higher level", () => {
    const rows = cardioRecordRows(sets, "level")
    expect(rows.map((r) => r.reps)).toEqual([8, 5, 4])
    expect(rows.filter((r) => r.isTopOneRm).map((r) => r.reps)).toEqual([5])
    expect(rows.map((r) => r.share)).toEqual([1, 5 / 8, 4 / 8])
  })

  it("sorts recent by date, then time", () => {
    expect(cardioRecordRows(sets, "recent").map((r) => r.date)).toEqual([
      "2026-09-20",
      "2026-09-15",
      "2026-09-10",
    ])
  })

  it("has cardio sorts and wording, and no 1RM", () => {
    expect(recordSorts(true)).toBe(CARDIO_SORTS)
    expect(CARDIO_SORTS.map((s) => s.label)).toEqual(["Longest", "Level", "Recent"])
    expect(recordSortFor("oneRm", true)).toBe("longest")
    expect(recordSortFor("level", false)).toBe("weight")
    expect(recordsSectionTitle(true)).toBe("Level records")
    expect(showAllRecordsLabel(6, true)).toBe("Show all 6 levels")
    expect(recordRows(sets, "oneRm", true)).toEqual(cardioRecordRows(sets, "longest"))
  })

  it("leaves weight records exactly as they were", () => {
    const w = weightRepSets([
      day("2026-09-20", [
        [100, 5],
        [90, 8],
      ]),
      day("2026-09-10", [[105, 5]]),
    ])
    expect(recordSorts(false)).toBe(REP_SORTS)
    for (const s of ["weight", "oneRm", "reps", "recent"] as const) {
      expect(recordRows(w, s, false)).toEqual(repRecordRows(w, s))
    }
    expect(recordsSectionTitle(false)).toBe("Rep records")
    expect(showAllRecordsLabel(6, false)).toBe("Show all 6 rep counts")
  })
})

describe("acceptClockText (the cardio Time field)", () => {
  const v = (t: string) => acceptClockText(t)?.value
  it("reads minutes, m:ss and h:mm:ss", () => {
    expect(v("32")).toBe(32)
    expect(v("32:18")).toBeCloseTo(32.3, 10)
    expect(v("1:05:00")).toBe(65)
    expect(formatCardioTime(v("32:18")!)).toBe("32:18")
  })
  it("takes partial input while typing", () => {
    expect(v("")).toBe(0)
    expect(v("32:")).toBe(32)
    expect(v("32:7")).toBeCloseTo(32 + 7 / 60, 10)
  })
  it("reads the number pad's . or , key as :", () => {
    const want = { text: "32:18", value: acceptClockText("32:18")!.value }
    expect(acceptClockText("32.18")).toEqual(want)
    expect(acceptClockText("32,18")).toEqual(want)
  })
  it("refuses seconds past 59, a third digit and a fourth part", () => {
    expect(acceptClockText("32:60")).toBeNull()
    expect(acceptClockText("32:180")).toBeNull()
    expect(acceptClockText("1:2:3:4")).toBeNull()
  })
  it("round-trips what the field shows", () => {
    for (const m of [0, 20, 32.3, 59.5, 65, 90.25]) {
      expect(formatCardioTime(v(formatCardioTime(m))!)).toBe(formatCardioTime(m))
    }
  })
})
