import { describe, it, expect, beforeEach } from "vitest"
import * as M from "@lift/core/store/mutations"
import { resetStore, currentSnapshot, loadSnapshot } from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

/** PR flags for a set, read fresh from the store (addSet returns a stale row). */
function flags(setId: number) {
  const s = currentSnapshot().sets.find((x) => x.id === setId)!
  return {
    is_pr: s.is_pr,
    was_pr: s.was_pr,
    is_position_pr: s.is_position_pr,
    was_position_pr: s.was_position_pr,
  }
}

beforeEach(() => resetStore())

describe("current PR (is_pr)", () => {
  it("marks the only logged set as a PR", () => {
    const w = M.createWorkout("2026-01-01").row
    const wex = M.addExerciseToWorkout(w.id, 1)
    const s = M.addSet(wex.id, { weight: 100, reps: 5 })
    expect(flags(s.id).is_pr).toBe(true)
  })

  it("moves the gold star when a later set dominates, but keeps was_pr sticky", () => {
    const w1 = M.createWorkout("2026-01-01").row
    const we1 = M.addExerciseToWorkout(w1.id, 1)
    const s1 = M.addSet(we1.id, { weight: 100, reps: 5 })

    const w2 = M.createWorkout("2026-01-08").row
    const we2 = M.addExerciseToWorkout(w2.id, 1)
    const s2 = M.addSet(we2.id, { weight: 110, reps: 5 })

    expect(flags(s1.id)).toMatchObject({ is_pr: false, was_pr: true })
    expect(flags(s2.id)).toMatchObject({ is_pr: true, was_pr: true })
  })

  it("keeps both sets on the pareto frontier (heavier-but-fewer-reps)", () => {
    const w = M.createWorkout("2026-01-01").row
    const wex = M.addExerciseToWorkout(w.id, 1)
    const heavy = M.addSet(wex.id, { weight: 110, reps: 3 })
    const reps = M.addSet(wex.id, { weight: 100, reps: 5 })
    expect(flags(heavy.id).is_pr).toBe(true)
    expect(flags(reps.id).is_pr).toBe(true)
  })

  it("does not compute PRs for cardio (distance_time) exercises", () => {
    const cardio = M.createExercise({
      name: "Treadmill X",
      category: "cardio",
      kind: "distance_time",
    })
    const w = M.createWorkout("2026-01-01").row
    const wex = M.addExerciseToWorkout(w.id, cardio.id)
    const s = M.addSet(wex.id, { distance_m: 5000, time_seconds: 1500 })
    expect(flags(s.id).is_pr).toBe(false)
  })

  it("removing the record set re-promotes the next best", () => {
    const w = M.createWorkout("2026-01-01").row
    const wex = M.addExerciseToWorkout(w.id, 1)
    const lower = M.addSet(wex.id, { weight: 100, reps: 5 })
    const top = M.addSet(wex.id, { weight: 120, reps: 5 })
    expect(flags(lower.id).is_pr).toBe(false)

    M.deleteSet(top.id)
    expect(flags(lower.id).is_pr).toBe(true)
  })
})

describe("position PR (is_position_pr)", () => {
  it("marks the best set within its position bucket even if not an overall PR", () => {
    // Workout A: pos1=100x5, pos2=80x5
    const a = M.createWorkout("2026-02-01").row
    const aWe = M.addExerciseToWorkout(a.id, 1)
    M.addSet(aWe.id, { weight: 100, reps: 5 }) // pos1
    M.addSet(aWe.id, { weight: 80, reps: 5 }) // pos2

    // Workout B (later): pos1=90x5, pos2=85x5
    const b = M.createWorkout("2026-02-08").row
    const bWe = M.addExerciseToWorkout(b.id, 1)
    M.addSet(bWe.id, { weight: 90, reps: 5 }) // pos1
    const bPos2 = M.addSet(bWe.id, { weight: 85, reps: 5 }) // pos2

    const f = flags(bPos2.id)
    // 85x5 is dominated overall by 100x5, so not an overall PR...
    expect(f.is_pr).toBe(false)
    // ...but it is the heaviest 2nd set, so it IS a position PR.
    expect(f.is_position_pr).toBe(true)
  })
})

describe("recomputeAllPrs (historical derivation)", () => {
  it("derives is_pr/was_pr from scratch over an imported-style snapshot", () => {
    // Build a snapshot directly (as an import would) with all flags false,
    // then run the full recompute pass.
    const snap = blankSnapshot()
    snap.exercises = [exercise(100, "Bench")]
    snap.workouts = [workout(1, "2026-01-01"), workout(2, "2026-01-08")]
    snap.workout_exercises = [we(10, 1, 100, 0), we(11, 2, 100, 0)]
    snap.sets = [
      set(1000, 10, { weight: 100, reps: 5, order: 0 }),
      set(1001, 11, { weight: 110, reps: 5, order: 0 }),
    ]
    loadSnapshot(snap)

    const { recomputed } = M.recomputeAllPrs()
    expect(recomputed).toBe(1)

    const earlier = currentSnapshot().sets.find((s) => s.id === 1000)!
    const later = currentSnapshot().sets.find((s) => s.id === 1001)!
    // current record is the later, heavier set
    expect(later.is_pr).toBe(true)
    // the earlier set was a record at the time → historical (was_pr) but not current
    expect(earlier.is_pr).toBe(false)
    expect(earlier.was_pr).toBe(true)
  })
})
