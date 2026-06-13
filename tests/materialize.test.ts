import { describe, it, expect } from "vitest"
import { buildIndexes } from "@lift/core/store/indexes"
import {
  estimateOneRm,
  setFromRow,
  weFromRow,
  workoutFromRow,
  historySetFromRow,
} from "@lift/core/store/materialize"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

describe("estimateOneRm (Brzycki)", () => {
  it("returns the weight unchanged for a single rep", () => {
    expect(estimateOneRm(100, 1)).toBe(100)
  })

  it("estimates a higher 1RM for multi-rep sets", () => {
    // 100kg x 5 -> ~112.6 kg
    expect(estimateOneRm(100, 5)).toBeCloseTo(112.7, 0)
  })

  it("returns 0 when weight is null", () => {
    expect(estimateOneRm(null, 5)).toBe(0)
  })

  it("returns 0 when reps are missing or non-positive", () => {
    expect(estimateOneRm(100, null)).toBe(0)
    expect(estimateOneRm(100, 0)).toBe(0)
  })

  it("falls back to the raw weight when the denominator collapses", () => {
    // Brzycki denominator 1.0278 - 0.0278*reps goes <= 0 around 37 reps.
    expect(estimateOneRm(50, 40)).toBe(50)
  })
})

describe("setFromRow", () => {
  it("maps every stored field onto the view model", () => {
    const row = set(1, 10, {
      weight: 80,
      reps: 8,
      note: "tough",
      order: 2,
      is_pr: true,
    })
    const vm = setFromRow(row)
    expect(vm).toMatchObject({
      id: 1,
      weight: 80,
      reps: 8,
      note: "tough",
      order: 2,
      is_pr: true,
      is_planned: false,
    })
  })
})

describe("historySetFromRow", () => {
  it("attaches an estimated 1RM", () => {
    const vm = historySetFromRow(set(1, 10, { weight: 100, reps: 1 }))
    expect(vm.estimated_one_rm).toBe(100)
  })
})

describe("weFromRow / workoutFromRow", () => {
  function snapshotWithDuration() {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    const w = workout(1, "2026-03-01")
    w.started_at = "2026-03-01T10:00:00.000Z"
    w.finished_at = "2026-03-01T11:30:00.000Z"
    snap.workouts = [w]
    snap.workout_exercises = [we(10, 1, 100, 0)]
    snap.sets = [
      set(1000, 10, { weight: 60, reps: 5, order: 1 }),
      set(1001, 10, { weight: 60, reps: 5, order: 0 }),
    ]
    return snap
  }

  it("materializes a workout-exercise with sorted sets and resolved exercise", () => {
    const snap = snapshotWithDuration()
    const ix = buildIndexes(snap)
    const vm = weFromRow(snap.workout_exercises[0], ix)
    expect(vm.exercise.name).toBe("Bench")
    expect(vm.sets.map((s) => s.order)).toEqual([0, 1])
  })

  it("computes duration_seconds from started_at/finished_at", () => {
    const snap = snapshotWithDuration()
    const ix = buildIndexes(snap)
    const vm = workoutFromRow(snap.workouts[0], ix)
    expect(vm.duration_seconds).toBe(90 * 60)
    expect(vm.exercises).toHaveLength(1)
  })

  it("leaves duration_seconds null when timestamps are missing", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-03-01")]
    const ix = buildIndexes(snap)
    const vm = workoutFromRow(snap.workouts[0], ix)
    expect(vm.duration_seconds).toBeNull()
  })
})
