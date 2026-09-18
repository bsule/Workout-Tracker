import { expect, it, vi } from "vitest"
import * as M from "@lift/core/store/mutations"
import { subscribe } from "@lift/core/store/store"
import { currentSnapshot, resetStore } from "./helpers/store"

it("deletes a selection across exercises in one store notification and promotes remaining records", () => {
  resetStore()
  const workout = M.createWorkout("2026-01-01").row
  const bench = M.addExerciseToWorkout(workout.id, 1)
  const squat = M.addExerciseToWorkout(workout.id, 2)
  const low = M.addSet(bench.id, { weight: 50, reps: 5 })
  const high = M.addSet(bench.id, { weight: 100, reps: 5 })
  const mid = M.addSet(bench.id, { weight: 75, reps: 5 })
  const other = M.addSet(squat.id, { weight: 100, reps: 8 })
  const notify = vi.fn()
  const unsubscribe = subscribe(notify)
  try {
    M.deleteSets([high.id, mid.id, high.id, other.id, -1])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(currentSnapshot().sets).toHaveLength(1)
    expect(currentSnapshot().sets[0]).toMatchObject({
      id: low.id, is_pr: true, is_position_pr: true, was_pr: true,
    })
  } finally {
    unsubscribe()
  }
})
