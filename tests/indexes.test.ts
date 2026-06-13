import { describe, it, expect } from "vitest"
import { buildIndexes } from "@lift/core/store/indexes"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

function sampleSnapshot() {
  const snap = blankSnapshot()
  snap.exercises = [exercise(100, "Bench"), exercise(101, "Squat", "legs")]
  snap.workouts = [
    workout(1, "2026-01-05"),
    workout(2, "2026-01-12"),
    workout(3, "2026-02-01"),
  ]
  snap.workout_exercises = [
    we(10, 1, 100, 0),
    we(11, 1, 101, 1),
    we(12, 2, 100, 0),
  ]
  snap.sets = [
    set(1000, 10, { weight: 60, reps: 5, order: 1 }),
    set(1001, 10, { weight: 60, reps: 5, order: 0 }),
  ]
  return snap
}

describe("buildIndexes", () => {
  it("indexes exercises by id", () => {
    const ix = buildIndexes(sampleSnapshot())
    expect(ix.exerciseById.get(100)?.name).toBe("Bench")
    expect(ix.exerciseById.get(101)?.category).toBe("legs")
  })

  it("indexes workouts by id and date", () => {
    const ix = buildIndexes(sampleSnapshot())
    expect(ix.workoutById.get(2)?.date).toBe("2026-01-12")
    expect(ix.workoutsByDate.get("2026-02-01")?.id).toBe(3)
  })

  it("buckets workouts by YYYY-MM month key", () => {
    const ix = buildIndexes(sampleSnapshot())
    expect(ix.workoutsByMonth.get("2026-01")?.map((w) => w.id)).toEqual([1, 2])
    expect(ix.workoutsByMonth.get("2026-02")?.map((w) => w.id)).toEqual([3])
  })

  it("groups workout-exercises by workout, sorted by order", () => {
    const ix = buildIndexes(sampleSnapshot())
    const forWorkout1 = ix.workoutExercisesByWorkout.get(1)!
    expect(forWorkout1.map((x) => x.id)).toEqual([10, 11])
  })

  it("groups workout-exercises by exercise", () => {
    const ix = buildIndexes(sampleSnapshot())
    expect(ix.workoutExercisesByExercise.get(100)?.map((x) => x.id)).toEqual([
      10, 12,
    ])
  })

  it("sorts sets within a workout-exercise by order", () => {
    const ix = buildIndexes(sampleSnapshot())
    const sets = ix.setsByWorkoutExercise.get(10)!
    expect(sets.map((s) => s.id)).toEqual([1001, 1000])
    expect(sets.map((s) => s.order)).toEqual([0, 1])
  })

  it("returns empty maps for an empty snapshot", () => {
    const ix = buildIndexes(blankSnapshot())
    expect(ix.exerciseById.size).toBe(0)
    expect(ix.workoutsByMonth.size).toBe(0)
  })
})
