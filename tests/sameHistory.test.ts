import { describe, expect, it } from "vitest"
import { sameHistory } from "../mobile/src/store/sameHistory"
import type { ExerciseHistoryDay, HistorySet } from "@lift/core/types"

function set(id: number, over: Partial<HistorySet> = {}): HistorySet {
  return {
    id,
    weight: 100,
    reps: 5,
    distance_m: null,
    distance_unit_display: "",
    time_seconds: null,
    is_pr: false,
    was_pr: false,
    is_position_pr: false,
    was_position_pr: false,
    note: "",
    order: 0,
    position: 1,
    estimated_one_rm: 116.7,
    ...over,
  }
}

function day(date: string, sets: HistorySet[], note = ""): ExerciseHistoryDay {
  return { date, note, sets }
}

describe("sameHistory", () => {
  it("is true for two arrays with equal content and different identity", () => {
    const a = [day("2026-09-01", [set(1), set(2)])]
    const b = [day("2026-09-01", [set(1), set(2)])]
    expect(a).not.toBe(b)
    expect(sameHistory(a, b)).toBe(true)
  })

  it("is true for the same array", () => {
    const a = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, a)).toBe(true)
  })

  it("is false when a day is added", () => {
    const a = [day("2026-09-01", [set(1)])]
    const b = [day("2026-09-02", [set(3)]), day("2026-09-01", [set(1)])]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is false when a set is removed", () => {
    const a = [day("2026-09-01", [set(1), set(2)])]
    const b = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is false when a set field changes", () => {
    const a = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, [day("2026-09-01", [set(1, { weight: 102.5 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { reps: 6 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { is_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { was_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { is_position_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { was_position_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { note: "x" })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { position: 2 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { estimated_one_rm: 120 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { order: 3 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { time_seconds: 60 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { distance_m: 1000 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { distance_unit_display: "km" })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(2)])])).toBe(false)
  })

  it("is false when a day note changes", () => {
    const a = [day("2026-09-01", [set(1)], "easy")]
    const b = [day("2026-09-01", [set(1)], "hard")]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is false when a day date changes", () => {
    const a = [day("2026-09-01", [set(1)])]
    const b = [day("2026-09-02", [set(1)])]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is true for two empty arrays", () => {
    expect(sameHistory([], [])).toBe(true)
  })
})
