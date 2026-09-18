import { describe, it, expect, beforeEach } from "vitest"
import { getExerciseHistoryQ } from "@lift/core/store/queries"
import {
  topRepRecords,
  topRepRecordsByPosition,
} from "@lift/core/store/records"
import { recomputePrsForExercise } from "@lift/core/store/prs"
import type { ExerciseHistoryDay } from "@lift/core/types"
import { loadSnapshot, resetStore } from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

/**
 * Two sessions of Bench:
 *   2026-01-05  60x5  65x5  62.5x8
 *   2026-01-12  62.5x5  70x3  60x8
 * Positions run 1..3 within each session.
 */
function twoSessions() {
  const snap = blankSnapshot()
  snap.exercises = [exercise(100, "Bench")]
  snap.workouts = [
    workout(1, "2026-01-05", "", "done"),
    workout(2, "2026-01-12", "", "done"),
  ]
  snap.workout_exercises = [we(10, 1, 100, 0), we(11, 2, 100, 0)]
  snap.sets = [
    set(1000, 10, { weight: 60, reps: 5, order: 0 }),
    set(1001, 10, { weight: 65, reps: 5, order: 1 }),
    set(1002, 10, { weight: 62.5, reps: 8, order: 2 }),
    set(1003, 11, { weight: 62.5, reps: 5, order: 0 }),
    set(1004, 11, { weight: 70, reps: 3, order: 1 }),
    set(1005, 11, { weight: 60, reps: 8, order: 2 }),
  ]
  loadSnapshot(snap)
  return snap
}

describe("getExerciseHistoryQ set positions", () => {
  beforeEach(() => resetStore())

  it("numbers sets 1..n within each workout_exercise", () => {
    twoSessions()
    const days = getExerciseHistoryQ(100)
    for (const day of days) {
      expect(day.sets.map((s) => s.position)).toEqual([1, 2, 3])
    }
  })

  it("gives planned sets no position and does not let them shift the rest", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-05", "", "done")]
    snap.workout_exercises = [we(10, 1, 100, 0)]
    snap.sets = [
      set(1000, 10, { weight: 60, reps: 5, order: 0 }),
      // A planned set sitting between two logged ones. It is filtered out of
      // history entirely, so the set after it is still position 2.
      set(1001, 10, { weight: 80, reps: 5, order: 1, is_planned: true }),
      set(1002, 10, { weight: 65, reps: 5, order: 2 }),
    ]
    loadSnapshot(snap)

    const day = getExerciseHistoryQ(100)[0]
    expect(day.sets.map((s) => s.position)).toEqual([1, 2])
    expect(day.sets.map((s) => s.weight)).toEqual([60, 65])
  })

  it("gives a set with no weight/reps pair position 0 and skips it in the count", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-05", "", "done")]
    snap.workout_exercises = [we(10, 1, 100, 0)]
    snap.sets = [
      set(1000, 10, { weight: 60, reps: 5, order: 0 }),
      set(1001, 10, { time_seconds: 90, order: 1 }),
      set(1002, 10, { weight: 65, reps: 5, order: 2 }),
    ]
    loadSnapshot(snap)

    expect(getExerciseHistoryQ(100)[0].sets.map((s) => s.position)).toEqual([
      1, 0, 2,
    ])
  })

  it("restarts positions for a second workout_exercise on the same date", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-05", "", "done")]
    // Same exercise twice in one day. The two runs merge into one history day,
    // but each is its own set of positions.
    snap.workout_exercises = [we(10, 1, 100, 0), we(11, 1, 100, 1)]
    snap.sets = [
      set(1000, 10, { weight: 60, reps: 5, order: 0 }),
      set(1001, 10, { weight: 65, reps: 5, order: 1 }),
      set(1002, 11, { weight: 50, reps: 12, order: 0 }),
      set(1003, 11, { weight: 55, reps: 10, order: 1 }),
    ]
    loadSnapshot(snap)

    const day = getExerciseHistoryQ(100)[0]
    expect(day.sets).toHaveLength(4)
    expect(day.sets.map((s) => s.position)).toEqual([1, 2, 1, 2])
  })

  it("agrees with the position PR flags prs.ts computes", () => {
    const snap = twoSessions()
    const next = recomputePrsForExercise(snap, 100)
    loadSnapshot(next)

    const flagged = getExerciseHistoryQ(100)
      .flatMap((d) => d.sets)
      .filter((s) => s.is_position_pr)
      .map((s) => ({ position: s.position, weight: s.weight }))

    // Heaviest at each position: 62.5 at 1, 70 at 2, 62.5x8 at 3.
    expect(flagged).toEqual(
      expect.arrayContaining([
        { position: 1, weight: 62.5 },
        { position: 2, weight: 70 },
        { position: 3, weight: 62.5 },
      ])
    )
    // No flag ever lands on a set the history says has no position.
    expect(flagged.every((f) => f.position > 0)).toBe(true)
  })
})

describe("topRepRecords", () => {
  beforeEach(() => resetStore())

  it("returns the best weight at each rep count, heaviest first", () => {
    twoSessions()
    const days = getExerciseHistoryQ(100)
    expect(topRepRecords(days, 3)).toEqual([
      { reps: 3, weightKg: 70, date: "2026-01-12" },
      { reps: 5, weightKg: 65, date: "2026-01-05" },
      { reps: 8, weightKg: 62.5, date: "2026-01-05" },
    ])
  })

  it("honours the limit", () => {
    twoSessions()
    expect(topRepRecords(getExerciseHistoryQ(100), 2)).toHaveLength(2)
  })

  it("filters to one set position", () => {
    twoSessions()
    const days = getExerciseHistoryQ(100)
    // Position 1 saw 60x5 and 62.5x5. Same rep count, so one row wins.
    expect(topRepRecords(days, 3, { position: 1 })).toEqual([
      { reps: 5, weightKg: 62.5, date: "2026-01-12" },
    ])
    // Position 2 saw 65x5 and 70x3. Different rep counts, so both survive.
    expect(topRepRecords(days, 3, { position: 2 })).toEqual([
      { reps: 3, weightKg: 70, date: "2026-01-12" },
      { reps: 5, weightKg: 65, date: "2026-01-05" },
    ])
  })

  it("returns nothing for a position with no history", () => {
    twoSessions()
    expect(topRepRecords(getExerciseHistoryQ(100), 3, { position: 4 })).toEqual(
      []
    )
  })

  it("never matches a set that has no position", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-05", "", "done")]
    snap.workout_exercises = [we(10, 1, 100, 0)]
    snap.sets = [set(1000, 10, { time_seconds: 90, order: 0 })]
    loadSnapshot(snap)

    const days = getExerciseHistoryQ(100)
    expect(days[0].sets[0].position).toBe(0)
    expect(topRepRecords(days, 3, { position: 0 })).toEqual([])
  })

  it("compares on weightKey, so float noise cannot decide a tie", () => {
    // 125 lb typed vs 125 lb imported: the same displayed weight, kg values
    // that differ in the third decimal. Under a raw float compare the larger
    // float would win and the answer would flip when the two are swapped.
    // Under weightKey they are equal, so the tie falls to a stable rule -
    // history runs newest date first, and the first row seen keeps the slot.
    const build = (earlyKg: number, lateKg: number) => {
      const snap = blankSnapshot()
      snap.exercises = [exercise(100, "Bench")]
      snap.workouts = [
        workout(1, "2026-01-05", "", "done"),
        workout(2, "2026-01-12", "", "done"),
      ]
      snap.workout_exercises = [we(10, 1, 100, 0), we(11, 2, 100, 0)]
      snap.sets = [
        set(1000, 10, { weight: earlyKg, reps: 5, order: 0 }),
        set(1001, 11, { weight: lateKg, reps: 5, order: 0 }),
      ]
      loadSnapshot(snap)
      return topRepRecords(getExerciseHistoryQ(100), 3, { position: 1 })
    }

    const noisyLate = build(56.699, 56.7)
    const noisyEarly = build(56.7, 56.699)
    expect(noisyLate).toHaveLength(1)
    expect(noisyLate[0].date).toBe("2026-01-12")
    // Swapping which row carries the noise changes nothing.
    expect(noisyEarly.map((r) => r.date)).toEqual(
      noisyLate.map((r) => r.date)
    )
  })
})

describe("topRepRecordsByPosition", () => {
  beforeEach(() => resetStore())

  it("matches topRepRecords for every position it holds", () => {
    twoSessions()
    const days = getExerciseHistoryQ(100)
    const map = topRepRecordsByPosition(days, 3)
    expect([...map.keys()].sort()).toEqual([1, 2, 3])
    for (const [position, rows] of map) {
      expect(rows).toEqual(topRepRecords(days, 3, { position }))
    }
  })

  it("holds no entry for a position with no history", () => {
    twoSessions()
    expect(topRepRecordsByPosition(getExerciseHistoryQ(100), 3).has(4)).toBe(
      false
    )
  })

  it("holds no entry for position 0", () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-05", "", "done")]
    snap.workout_exercises = [we(10, 1, 100, 0)]
    snap.sets = [set(1000, 10, { time_seconds: 90, order: 0 })]
    loadSnapshot(snap)

    expect(topRepRecordsByPosition(getExerciseHistoryQ(100), 3).size).toBe(0)
  })

  it("takes no store state, so it works on a hand-built day list", () => {
    const days: ExerciseHistoryDay[] = [
      {
        date: "2026-02-01",
        note: "",
        sets: [
          {
            id: 1,
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
            position: 2,
            estimated_one_rm: 0,
          },
        ],
      },
    ]
    expect(topRepRecordsByPosition(days, 3).get(2)).toEqual([
      { reps: 5, weightKg: 100, date: "2026-02-01" },
    ])
  })
})
