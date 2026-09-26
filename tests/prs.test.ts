import { describe, it, expect, beforeEach } from "vitest"
import * as M from "@lift/core/store/mutations"
import { resetStore, currentSnapshot, loadSnapshot } from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"
import { toKg } from "@lift/core/units"

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

  it("moves the gold star when a later set dominates, and the dethroned set keeps was_pr", () => {
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

describe("PR flags survive the other set-destroying mutations", () => {
  // Every mutation that adds or removes rows from snap.sets has to rerun the
  // PR pass, not just addSet/deleteSet. These three used to skip it, so
  // deleting a workout (or backing out of an exercise on mobile, which calls
  // removeExerciseFromWorkout) left the gold star on a row that no longer
  // existed — the record simply vanished from the UI until something else
  // happened to trigger a recompute.
  function twoDays() {
    const ex = M.createExercise({ name: "Bench", category: "chest" })
    const w1 = M.createWorkout("2026-01-01").row
    const we1 = M.addExerciseToWorkout(w1.id, ex.id)
    const light = M.addSet(we1.id, { weight: 100, reps: 5 })
    const w2 = M.createWorkout("2026-01-08").row
    const we2 = M.addExerciseToWorkout(w2.id, ex.id)
    const heavy = M.addSet(we2.id, { weight: 110, reps: 5 })
    return { ex, w1, we1, light, w2, we2, heavy }
  }

  it("removeExerciseFromWorkout moves the crown to the runner-up", () => {
    const { w2, we2, light, heavy } = twoDays()
    expect(flags(heavy.id).is_pr).toBe(true)

    M.removeExerciseFromWorkout(w2.id, we2.id)

    expect(currentSnapshot().sets.some((s) => s.id === heavy.id)).toBe(false)
    expect(flags(light.id).is_pr).toBe(true)
    expect(flags(light.id).is_position_pr).toBe(true)
  })

  it("deleteWorkout moves the crown to the runner-up", () => {
    const { w2, light, heavy } = twoDays()
    M.deleteWorkout(w2.id)

    expect(currentSnapshot().sets.some((s) => s.id === heavy.id)).toBe(false)
    expect(flags(light.id).is_pr).toBe(true)
  })

  it("deleteWorkout recomputes every exercise on the deleted day", () => {
    const bench = M.createExercise({ name: "Bench", category: "chest" })
    const squat = M.createExercise({ name: "Squat", category: "legs" })
    const w1 = M.createWorkout("2026-01-01").row
    const b1 = M.addSet(M.addExerciseToWorkout(w1.id, bench.id).id, {
      weight: 100,
      reps: 5,
    })
    const s1 = M.addSet(M.addExerciseToWorkout(w1.id, squat.id).id, {
      weight: 140,
      reps: 5,
    })
    const w2 = M.createWorkout("2026-01-08").row
    M.addSet(M.addExerciseToWorkout(w2.id, bench.id).id, {
      weight: 110,
      reps: 5,
    })
    M.addSet(M.addExerciseToWorkout(w2.id, squat.id).id, {
      weight: 150,
      reps: 5,
    })

    M.deleteWorkout(w2.id)

    expect(flags(b1.id).is_pr).toBe(true)
    expect(flags(s1.id).is_pr).toBe(true)
  })

  it("copyFromWorkout onto an earlier date gives the copy the tie-break", () => {
    const ex = M.createExercise({ name: "Deadlift", category: "back" })
    const src = M.createWorkout("2026-03-01").row
    const orig = M.addSet(M.addExerciseToWorkout(src.id, ex.id).id, {
      weight: 300,
      reps: 5,
    })
    expect(flags(orig.id).is_pr).toBe(true)

    // Exact ties are broken by "earliest wins", so a copy back-filled onto an
    // earlier day takes the record off the original.
    const dst = M.createWorkout("2026-02-01").row
    M.copyFromWorkout(dst.id, src.id, true)

    const copy = currentSnapshot().sets.find(
      (s) => s.weight === 300 && s.id !== orig.id
    )!
    expect(copy.is_pr).toBe(true)
    expect(flags(orig.id).is_pr).toBe(false)
  })

  it("copyFromWorkout leaves a same-day copy dominated by its original", () => {
    const ex = M.createExercise({ name: "Press", category: "shoulders" })
    const src = M.createWorkout("2026-03-01").row
    const orig = M.addSet(M.addExerciseToWorkout(src.id, ex.id).id, {
      weight: 60,
      reps: 5,
    })
    const dst = M.createWorkout("2026-03-08").row
    M.copyFromWorkout(dst.id, src.id, true)

    const copy = currentSnapshot().sets.find(
      (s) => s.weight === 60 && s.id !== orig.id
    )!
    expect(flags(orig.id).is_pr).toBe(true)
    expect(copy.is_pr).toBe(false)
  })
})

describe("weights that display the same compare the same", () => {
  // A FitNotes CSV import stores the kg column at two decimals; the same
  // weight typed in lb converts to a long float. Both render identically, so
  // neither may outrank the other on the strength of the third decimal.
  const typed = (lb: number) => toKg(lb, "lb")
  const imported = (lb: number) => Math.round(toKg(lb, "lb") * 100) / 100

  it("lets an imported 135x7 dominate a later typed 135x5", () => {
    // 135 lb rounds DOWN into the kg column (61.23 vs 61.23496995), so the old
    // raw compare found no domination at all and handed the 5-rep set a PR.
    const ex = M.createExercise({ name: "Row", category: "back" })
    const w1 = M.createWorkout("2026-01-01").row
    const old = M.addSet(M.addExerciseToWorkout(w1.id, ex.id).id, {
      weight: imported(135),
      reps: 7,
    })
    const w2 = M.createWorkout("2026-02-01").row
    const fresh = M.addSet(M.addExerciseToWorkout(w2.id, ex.id).id, {
      weight: typed(135),
      reps: 5,
    })

    expect(flags(fresh.id).is_pr).toBe(false)
    expect(flags(old.id).is_pr).toBe(true)
  })

  it("lets a typed 125x8 dominate an imported 125x7", () => {
    // 125 lb rounds UP into the kg column (56.70 vs 56.69904625), so the raw
    // compare made the 7-rep set look heavier than the 8-rep one.
    const ex = M.createExercise({ name: "Curl", category: "arms" })
    const w1 = M.createWorkout("2026-01-01").row
    const seven = M.addSet(M.addExerciseToWorkout(w1.id, ex.id).id, {
      weight: imported(125),
      reps: 7,
    })
    const w2 = M.createWorkout("2026-02-01").row
    const eight = M.addSet(M.addExerciseToWorkout(w2.id, ex.id).id, {
      weight: typed(125),
      reps: 8,
    })

    expect(flags(eight.id).is_pr).toBe(true)
    expect(flags(seven.id).is_pr).toBe(false)
  })

  it("still breaks an exact-looking tie on the earlier set", () => {
    const ex = M.createExercise({ name: "Bench", category: "chest" })
    const w1 = M.createWorkout("2026-01-01").row
    const first = M.addSet(M.addExerciseToWorkout(w1.id, ex.id).id, {
      weight: imported(185),
      reps: 5,
    })
    const w2 = M.createWorkout("2026-02-01").row
    const second = M.addSet(M.addExerciseToWorkout(w2.id, ex.id).id, {
      weight: typed(185),
      reps: 5,
    })

    expect(flags(first.id).is_pr).toBe(true)
    expect(flags(second.id).is_pr).toBe(false)
  })
})

// The historical star (was_pr) used to be sticky on live changes and derived
// only on import or migration, so an edit, a delete or a set logged on a past
// day left stars an import would not give. Live flags must now match a
// from-scratch pass after any of those.
describe("historical PRs after edits", () => {
  const allFlags = () =>
    currentSnapshot().sets.map((s) => [s.id, s.is_pr, s.was_pr, s.is_position_pr, s.was_position_pr])
  function expectMatchesFromScratch() {
    const live = allFlags()
    M.recomputeAllPrs()
    expect(live).toEqual(allFlags())
  }
  function day(date: string, sets: [number, number][]) {
    const wex = M.addExerciseToWorkout(M.createWorkout(date).row.id, 1)
    return sets.map(([weight, reps]) => M.addSet(wex.id, { weight, reps }).id)
  }

  it("drops the star from a record edited down", () => {
    day("2026-01-01", [[80, 5]])
    const [typo] = day("2026-01-02", [[100, 5]])
    M.updateSet(typo, { weight: 50 })
    expect(flags(typo)).toMatchObject({ is_pr: false, was_pr: false })
    expectMatchesFromScratch()
  })

  it("drops the stars from later sets when an older set is edited above them", () => {
    const [old] = day("2026-01-01", [[60, 5]])
    const [mid] = day("2026-01-02", [[70, 5]])
    day("2026-01-03", [[80, 5]])
    M.updateSet(old, { weight: 90 })
    expect(flags(mid).was_pr).toBe(false)
    expectMatchesFromScratch()
  })

  it("gives the star back to sets a deleted typo had blocked", () => {
    const [typo] = day("2026-01-01", [[1000, 5]])
    const [first] = day("2026-01-02", [[80, 5]])
    day("2026-01-03", [[90, 5]])
    M.deleteSet(typo)
    expect(flags(first)).toMatchObject({ is_pr: false, was_pr: true })
    expectMatchesFromScratch()
  })

  it("stars a set logged on a past day that was a record then", () => {
    day("2026-01-05", [[100, 5]])
    const [backfill] = day("2026-01-01", [[90, 5]])
    expect(flags(backfill)).toMatchObject({ is_pr: false, was_pr: true })
    expectMatchesFromScratch()
  })

  it("matches a from-scratch pass over a random run of adds, edits and deletes", () => {
    let seed = 3
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % max
    }
    const ids: number[] = []
    for (let step = 0; step < 120; step++) {
      const roll = random(10)
      if (roll < 5 || ids.length === 0) {
        // Any day in a month, so some land before sets already logged.
        const date = `2026-02-${String(1 + random(28)).padStart(2, "0")}`
        const w = M.createWorkout(date).row
        const wex = M.addExerciseToWorkout(w.id, 1)
        ids.push(M.addSet(wex.id, { weight: 40 + random(8) * 5, reps: 1 + random(8) }).id)
      } else if (roll < 8) {
        M.updateSet(ids[random(ids.length)], { weight: 40 + random(8) * 5, reps: 1 + random(8) })
      } else {
        M.deleteSet(ids.splice(random(ids.length), 1)[0])
      }
      const live = allFlags()
      M.recomputeAllPrs()
      expect(allFlags()).toEqual(live)
    }
  })
})
