// TEMPORARY: covers packages/core/src/store/cardioFix.ts. Delete with it.

import { describe, it, expect, beforeEach } from "vitest"
import * as M from "@lift/core/store/mutations"
import { currentSnapshot, resetStore } from "./helpers/store"

beforeEach(() => resetStore())

describe("recomputeAllPrs cardio fix", () => {
  it("switches old custom cardio to distance_time and clears its stars", () => {
    const w = M.createWorkout("2026-01-01").row
    // How an older build made it: cardio, but weight_reps.
    const bike = M.createExercise({ name: "Bike", category: "cardio", kind: "weight_reps" })
    const bench = M.createExercise({ name: "Bench", category: "chest" })
    const bikeWe = M.addExerciseToWorkout(w.id, bike.id)
    const benchWe = M.addExerciseToWorkout(w.id, bench.id)
    M.addSet(bikeWe.id, { weight: 20, reps: 5 })
    M.addSet(bikeWe.id, { weight: 30, reps: 5 })
    M.addSet(benchWe.id, { weight: 100, reps: 5 })
    const bikeSets = () => currentSnapshot().sets.filter((s) => s.workout_exercise_id === bikeWe.id)
    expect(bikeSets().some((s) => s.is_pr)).toBe(true)

    M.recomputeAllPrs()

    const snap = currentSnapshot()
    expect(snap.exercises.find((e) => e.id === bike.id)?.kind).toBe("distance_time")
    for (const s of bikeSets()) {
      expect([s.is_pr, s.was_pr, s.is_position_pr, s.was_position_pr]).toEqual([false, false, false, false])
    }
    // Other exercises keep their stars.
    expect(snap.sets.find((s) => s.workout_exercise_id === benchWe.id)?.is_pr).toBe(true)
  })
})
