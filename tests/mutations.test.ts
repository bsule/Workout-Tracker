import { describe, it, expect, beforeEach } from "vitest"
import * as M from "@lift/core/store/mutations"
import { FIRST_CUSTOM_ID, isSeedId } from "@lift/core/store/seed"
import { resetStore, currentSnapshot } from "./helpers/store"

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function offsetDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

beforeEach(() => resetStore())

describe("settings", () => {
  it("merges a patch into settings", () => {
    const next = M.updateSettings({ weight_unit: "kg" })
    expect(next.weight_unit).toBe("kg")
    expect(currentSnapshot().settings.weight_unit).toBe("kg")
  })
})

describe("exercises", () => {
  it("creates a custom exercise with an id past the seed range", () => {
    const row = M.createExercise({ name: "  Zercher Squat ", category: "legs" })
    expect(row.id).toBeGreaterThanOrEqual(FIRST_CUSTOM_ID)
    expect(isSeedId(row.id)).toBe(false)
    expect(row.name).toBe("Zercher Squat") // trimmed
    expect(row.is_custom).toBe(true)
  })

  it("patches a custom exercise in place", () => {
    const row = M.createExercise({ name: "Curl", category: "biceps" })
    const patched = M.patchExercise(row.id, { name: "Spider Curl" })
    expect(patched?.name).toBe("Spider Curl")
  })

  it("editing a seed exercise writes an override row into the snapshot", () => {
    const patched = M.patchExercise(1, { name: "Barbell Bench Press" })
    expect(patched?.name).toBe("Barbell Bench Press")
    expect(currentSnapshot().exercises.some((e) => e.id === 1)).toBe(true)
  })

  it("rejects a blank name (no-op, returns null and keeps the old name)", () => {
    const row = M.createExercise({ name: "Thing", category: "back" })
    const result = M.patchExercise(row.id, { name: "   " })
    expect(result).toBeNull()
    expect(currentSnapshot().exercises.find((e) => e.id === row.id)?.name).toBe(
      "Thing"
    )
  })

  it("hard-deletes an unreferenced custom exercise", () => {
    const row = M.createExercise({ name: "Temp", category: "back" })
    M.deleteExercise(row.id)
    expect(currentSnapshot().exercises.some((e) => e.id === row.id)).toBe(false)
  })

  it("soft-deletes a custom exercise that is referenced by a workout", () => {
    const ex = M.createExercise({ name: "Used", category: "back" })
    const w = M.createWorkout(offsetDate(-1)).row
    M.addExerciseToWorkout(w.id, ex.id)
    M.deleteExercise(ex.id)
    const stored = currentSnapshot().exercises.find((e) => e.id === ex.id)
    expect(stored?.is_deleted).toBe(true)
  })

  it("soft-deletes a seed exercise (writes a tombstone override)", () => {
    M.deleteExercise(1)
    const stored = currentSnapshot().exercises.find((e) => e.id === 1)
    expect(stored?.is_deleted).toBe(true)
  })
})

describe("workouts", () => {
  it("infers status from the date", () => {
    expect(M.createWorkout(offsetDate(-2)).row.status).toBe("done")
    expect(M.createWorkout(today()).row.status).toBe("active")
    expect(M.createWorkout(offsetDate(5)).row.status).toBe("planned")
  })

  it("returns the existing workout when one already exists for the date", () => {
    const first = M.createWorkout("2026-04-01").row
    const second = M.createWorkout("2026-04-01")
    expect(second.row.id).toBe(first.id)
    expect(currentSnapshot().workouts.filter((w) => w.date === "2026-04-01")).toHaveLength(1)
  })

  it("flags merged_into_finished when reusing a finished workout", () => {
    const w = M.createWorkout("2026-04-02").row
    M.finishWorkout(w.id)
    const again = M.createWorkout("2026-04-02")
    expect(again.merged_into_finished).toBe(true)
  })

  it("inherits the gym from the most recent prior workout", () => {
    const past = M.createWorkout("2026-03-01").row
    M.patchWorkout(past.id, { gym: "Iron House" })
    const next = M.createWorkout("2026-03-08").row
    expect(next.gym).toBe("Iron House")
  })

  it("creating/renaming a gym via patchWorkout registers it in the gym list", () => {
    const w = M.createWorkout("2026-03-15").row
    M.patchWorkout(w.id, { gym: "Garage Gym" })
    expect(currentSnapshot().gyms.some((g) => g.name === "Garage Gym")).toBe(true)
  })

  it("startPlannedWorkout / finishWorkout flip status and stamp times", () => {
    const w = M.createWorkout(offsetDate(3)).row
    expect(w.status).toBe("planned")
    const started = M.startPlannedWorkout(w.id)
    expect(started?.status).toBe("active")
    expect(started?.started_at).toBeTruthy()
    const finished = M.finishWorkout(w.id)
    expect(finished?.status).toBe("done")
    expect(finished?.finished_at).toBeTruthy()
  })

  it("deletes a workout and cascades its exercises and sets", () => {
    const w = M.createWorkout("2026-03-20").row
    const we = M.addExerciseToWorkout(w.id, 1)
    M.addSet(we.id, { weight: 100, reps: 5 })
    M.deleteWorkout(w.id)
    const snap = currentSnapshot()
    expect(snap.workouts.some((x) => x.id === w.id)).toBe(false)
    expect(snap.workout_exercises.some((x) => x.workout_id === w.id)).toBe(false)
    expect(snap.sets.some((s) => s.workout_exercise_id === we.id)).toBe(false)
  })
})

describe("workout exercises", () => {
  it("appends with an incrementing order and dedupes existing pairs", () => {
    const w = M.createWorkout("2026-05-01").row
    const a = M.addExerciseToWorkout(w.id, 1)
    const b = M.addExerciseToWorkout(w.id, 2)
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    const again = M.addExerciseToWorkout(w.id, 1)
    expect(again.id).toBe(a.id)
    expect(
      currentSnapshot().workout_exercises.filter((x) => x.workout_id === w.id)
    ).toHaveLength(2)
  })

  it("removing an exercise drops its sets too", () => {
    const w = M.createWorkout("2026-05-02").row
    const we = M.addExerciseToWorkout(w.id, 1)
    M.addSet(we.id, { weight: 50, reps: 10 })
    M.removeExerciseFromWorkout(w.id, we.id)
    const snap = currentSnapshot()
    expect(snap.workout_exercises.some((x) => x.id === we.id)).toBe(false)
    expect(snap.sets.some((s) => s.workout_exercise_id === we.id)).toBe(false)
  })
})

describe("sets", () => {
  function freshWe() {
    const w = M.createWorkout("2026-05-10").row
    return M.addExerciseToWorkout(w.id, 1)
  }

  it("orders new sets by max(order)+1, surviving a middle delete", () => {
    const we = freshWe()
    const s0 = M.addSet(we.id, { weight: 60, reps: 5 })
    const s1 = M.addSet(we.id, { weight: 60, reps: 5 })
    const s2 = M.addSet(we.id, { weight: 60, reps: 5 })
    expect([s0.order, s1.order, s2.order]).toEqual([0, 1, 2])
    M.deleteSet(s1.id)
    const s3 = M.addSet(we.id, { weight: 60, reps: 5 })
    // max remaining order is 2, so next is 3 (not a re-used slot)
    expect(s3.order).toBe(3)
  })

  it("updates weight/reps/note on a set", () => {
    const we = freshWe()
    const s = M.addSet(we.id, { weight: 60, reps: 5 })
    const updated = M.updateSet(s.id, { weight: 65, note: "felt good" })
    expect(updated?.weight).toBe(65)
    expect(updated?.note).toBe("felt good")
  })

  it("logPlannedSet converts a planned set into a logged one", () => {
    const we = freshWe()
    const planned = M.addSet(we.id, { weight: 80, reps: 5, is_planned: true })
    expect(planned.is_planned).toBe(true)
    const logged = M.logPlannedSet(planned.id, { weight: 82, reps: 5 })
    expect(logged?.is_planned).toBe(false)
    expect(logged?.weight).toBe(82)
  })
})

describe("gyms", () => {
  it("creates, renames, and deletes gyms", () => {
    const g = M.createGym("Old Name")
    expect(currentSnapshot().gyms.some((x) => x.id === g.id)).toBe(true)
    const renamed = M.renameGym(g.id, "New Name")
    expect(renamed?.name).toBe("New Name")
    M.deleteGym(g.id)
    expect(currentSnapshot().gyms.some((x) => x.id === g.id)).toBe(false)
  })

  it("dedupes gym creation by name", () => {
    M.createGym("Dupe")
    M.createGym("Dupe")
    expect(currentSnapshot().gyms.filter((g) => g.name === "Dupe")).toHaveLength(1)
  })

  it("renaming a gym rewrites the gym field on referencing workouts", () => {
    const w = M.createWorkout("2026-06-01").row
    M.patchWorkout(w.id, { gym: "Place A" })
    const gymRow = currentSnapshot().gyms.find((g) => g.name === "Place A")!
    M.renameGym(gymRow.id, "Place B")
    const updated = currentSnapshot().workouts.find((x) => x.id === w.id)
    expect(updated?.gym).toBe("Place B")
  })

  it("renameGym returns null on a name collision", () => {
    const a = M.createGym("Alpha")
    M.createGym("Beta")
    expect(M.renameGym(a.id, "Beta")).toBeNull()
  })

  it("renameGym returns null for a blank name", () => {
    const a = M.createGym("Alpha")
    expect(M.renameGym(a.id, "   ")).toBeNull()
  })
})

describe("copyFromWorkout", () => {
  it("copies exercises only by default", () => {
    const src = M.createWorkout("2026-07-01").row
    const we = M.addExerciseToWorkout(src.id, 1)
    M.addSet(we.id, { weight: 100, reps: 5 })
    const dst = M.createWorkout("2026-07-08").row

    M.copyFromWorkout(dst.id, src.id)
    const snap = currentSnapshot()
    const dstWes = snap.workout_exercises.filter((x) => x.workout_id === dst.id)
    expect(dstWes).toHaveLength(1)
    const dstSets = snap.sets.filter((s) => s.workout_exercise_id === dstWes[0].id)
    expect(dstSets).toHaveLength(0)
  })

  it("copies sets too when withSets is true", () => {
    const src = M.createWorkout("2026-07-02").row
    const we = M.addExerciseToWorkout(src.id, 1)
    M.addSet(we.id, { weight: 100, reps: 5 })
    M.addSet(we.id, { weight: 105, reps: 5 })
    const dst = M.createWorkout("2026-07-09").row

    M.copyFromWorkout(dst.id, src.id, true)
    const snap = currentSnapshot()
    const dstWe = snap.workout_exercises.find((x) => x.workout_id === dst.id)!
    const dstSets = snap.sets.filter((s) => s.workout_exercise_id === dstWe.id)
    expect(dstSets).toHaveLength(2)
    // copied sets are NOT carried over as PRs
    expect(dstSets.every((s) => s.is_pr === false)).toBe(true)
  })
})
