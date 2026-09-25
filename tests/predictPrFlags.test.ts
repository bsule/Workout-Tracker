import { beforeEach, expect, it } from "vitest"
import * as M from "@lift/core/store/mutations"
import { predictPrFlags } from "@lift/core/store/prs"
import { getState } from "@lift/core/store/store"
import { installMemoryStorage, resetStore } from "./helpers/store"

// The set logger's tap-time preview (predictPrFlags) and the flag the store
// saves (recomputePrsForExercise) share one record rule in prs.ts. Log a
// random run of sets, newest last, and check the preview before every add
// against what the add actually stored.

beforeEach(() => {
  resetStore()
  installMemoryStorage()
})

it("predicts the same PR and position-PR flags the store saves", () => {
  let seed = 7
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % max
  }
  const ex = M.createExercise({ name: "Parity Press", category: "chest" })
  let checked = 0
  for (let day = 1; day <= 25; day++) {
    const date = `2026-03-${String(day).padStart(2, "0")}`
    const w = M.createWorkout(date).row
    const we = M.addExerciseToWorkout(w.id, ex.id)
    const sets = 1 + random(5)
    for (let i = 0; i < sets; i++) {
      // Some weights differ only in float noise (an import vs a typed value),
      // which the shared rule compares through weightKey.
      const weight = 40 + random(6) * 5 + (random(3) === 0 ? 0.00004 : 0)
      const reps = 1 + random(10)
      const predicted = predictPrFlags(getState().indexes, ex.id, we.id, weight, reps)
      const row = M.addSet(we.id, { weight, reps })
      const saved = getState().snapshot.sets.find((s) => s.id === row.id)!
      expect({ isPr: predicted.isPr, isPosPr: predicted.isPosPr }).toEqual({
        isPr: saved.is_pr,
        isPosPr: saved.is_position_pr,
      })
      checked++
    }
  }
  expect(checked).toBeGreaterThan(40)
})

it("never predicts a record for a tie with an earlier set", () => {
  const ex = M.createExercise({ name: "Tie Row", category: "back" })
  const w1 = M.createWorkout("2026-03-01").row
  M.addSet(M.addExerciseToWorkout(w1.id, ex.id).id, { weight: 100, reps: 5 })
  const w2 = M.createWorkout("2026-03-02").row
  const we2 = M.addExerciseToWorkout(w2.id, ex.id)
  expect(predictPrFlags(getState().indexes, ex.id, we2.id, 100, 5)).toEqual({
    isPr: false,
    isPosPr: false,
    position: 1,
  })
  expect(predictPrFlags(getState().indexes, ex.id, we2.id, 100, 6).isPr).toBe(true)
})
