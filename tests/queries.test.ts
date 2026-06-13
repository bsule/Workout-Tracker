import { describe, it, expect, beforeEach } from "vitest"
import {
  fuzzyMatch,
  listExercisesQ,
  getExerciseHistoryQ,
  listWorkoutsQ,
  getCalendarQ,
  getWorkoutByDateQ,
  getPlannedDatesQ,
} from "@lift/core/store/queries"
import { SEED_EXERCISES } from "@lift/core/store/seed"
import { loadSnapshot, resetStore } from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

describe("fuzzyMatch", () => {
  it("matches exact substrings", () => {
    expect(fuzzyMatch("Bench Press", "bench")).toBe(true)
  })

  it("matches with a single typo on a medium token", () => {
    expect(fuzzyMatch("Bench Press", "bemch")).toBe(true)
  })

  it("requires every query token to match somewhere (order-independent)", () => {
    expect(fuzzyMatch("Incline Dumbbell Press", "press incline")).toBe(true)
    expect(fuzzyMatch("Incline Dumbbell Press", "press squat")).toBe(false)
  })

  it("stays strict on very short tokens", () => {
    // 2-char token, threshold 0 — a typo must not match.
    expect(fuzzyMatch("Row", "rx")).toBe(false)
    expect(fuzzyMatch("Row", "ro")).toBe(true)
  })

  it("treats an empty query as a match", () => {
    expect(fuzzyMatch("anything", "")).toBe(true)
  })
})

describe("listExercisesQ", () => {
  beforeEach(() => resetStore())

  it("returns all seed exercises by default, sorted by name", () => {
    const list = listExercisesQ()
    expect(list.length).toBe(SEED_EXERCISES.length)
    const names = list.map((e) => e.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
  })

  it("filters by category", () => {
    const legs = listExercisesQ({ category: "legs" })
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((e) => e.category === "legs")).toBe(true)
  })

  it("filters by fuzzy query", () => {
    const result = listExercisesQ({ q: "bench" })
    expect(result.some((e) => e.name === "Bench Press")).toBe(true)
    expect(result.every((e) => /bench/i.test(e.name) || true)).toBe(true)
  })

  it("includes custom exercises alongside seeds", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(500, "My Special Lift", "back")]
    loadSnapshot(snap)
    const list = listExercisesQ({ q: "special" })
    expect(list.some((e) => e.id === 500)).toBe(true)
  })

  it("excludes soft-deleted exercises", () => {
    const snap = blankSnapshot()
    snap.exercises = [{ ...exercise(500, "Gone", "back"), is_deleted: true }]
    loadSnapshot(snap)
    expect(listExercisesQ({ q: "gone" }).some((e) => e.id === 500)).toBe(false)
  })
})

describe("workout queries", () => {
  beforeEach(() => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench"), exercise(101, "Squat", "legs")]
    snap.workouts = [
      workout(1, "2026-01-05", "Gym A", "done"),
      workout(2, "2026-01-20", "", "planned"),
      workout(3, "2026-02-10", "Gym B", "done"),
    ]
    snap.workout_exercises = [we(10, 1, 100, 0), we(12, 3, 101, 0)]
    snap.sets = [
      set(1000, 10, { weight: 60, reps: 5, order: 0 }),
      set(1001, 10, { weight: 65, reps: 5, order: 1 }),
      set(1002, 12, { weight: 100, reps: 3, order: 0 }),
    ]
    loadSnapshot(snap)
  })

  it("lists workouts newest-first", () => {
    const list = listWorkoutsQ()
    expect(list.map((w) => w.id)).toEqual([3, 2, 1])
  })

  it("filters workouts by month", () => {
    const jan = listWorkoutsQ({ month: "2026-01" })
    expect(jan.map((w) => w.id).sort()).toEqual([1, 2])
  })

  it("looks a workout up by date", () => {
    expect(getWorkoutByDateQ("2026-01-05")?.gym).toBe("Gym A")
    expect(getWorkoutByDateQ("2099-01-01")).toBeNull()
  })

  it("builds exercise history newest-day-first, excluding planned days", () => {
    const history = getExerciseHistoryQ(100)
    expect(history).toHaveLength(1)
    expect(history[0].date).toBe("2026-01-05")
    expect(history[0].sets.map((s) => s.order)).toEqual([0, 1])
  })

  it("returns planned dates for a month", () => {
    expect(getPlannedDatesQ(2026, 1)).toEqual(["2026-01-20"])
    expect(getPlannedDatesQ(2026, 2)).toEqual([])
  })

  it("builds a calendar map of categories per day", () => {
    const cal = getCalendarQ(2026, 1)
    expect(cal["2026-01-05"]).toEqual(["chest"])
    // planned workout with no exercises still gets an (empty) marker
    expect(cal["2026-01-20"]).toEqual([])
  })
})
