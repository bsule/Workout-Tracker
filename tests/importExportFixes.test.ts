import { beforeEach, describe, expect, it } from "vitest"
import { buildJson } from "@lift/core/export"
import { FITNOTES_HEADERS, importFitnotesCsv, importSnapshotJson } from "@lift/core/import"
import { installMemoryStorage, resetStore, loadSnapshot, currentSnapshot } from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

const HEADER = FITNOTES_HEADERS.join(",")
const csv = (rows: string[]) => [HEADER, ...rows].join("\n") + "\n"

beforeEach(() => {
  installMemoryStorage()
  resetStore()
})

function loggedSets() {
  return currentSnapshot().sets.filter((s) => !s.is_planned)
}

describe("FitNotes CSV merge re-import", () => {
  const file = csv([
    "2026-01-01,Zercher Squat,Legs,100,,5,,,,,wr",
    "2026-01-01,Zercher Squat,Legs,100,,5,,,,,wr",
    "2026-01-01,Zercher Squat,Legs,100,,5,,,,,wr",
    "2026-01-02,Spoto Press,Chest,,135,8,,,,,wr",
    "2026-01-03,Running,Cardio,,,,5,km,25:00,,dt",
  ])

  it("importing the same file twice adds nothing the second time", async () => {
    const first = await importFitnotesCsv(file, { mode: "merge" })
    expect(first.imported).toBe(5)
    const after = currentSnapshot()
    const second = await importFitnotesCsv(file, { mode: "merge" })
    expect(second.imported).toBe(0)
    expect(loggedSets()).toHaveLength(5)
    expect(currentSnapshot().workouts).toHaveLength(after.workouts.length)
    expect(currentSnapshot().workout_exercises).toHaveLength(after.workout_exercises.length)
  })

  it("matches each saved set once and puts new sets after the existing ones", async () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(5001, "Zercher Squat", "legs")]
    snap.workouts = [workout(1, "2026-01-01")]
    snap.workout_exercises = [we(10, 1, 5001)]
    // One matching set already logged, plus a planned set at order 3.
    snap.sets = [
      set(100, 10, { weight: 100, reps: 5, order: 0 }),
      set(101, 10, { weight: 60, reps: 10, order: 3, is_planned: true }),
    ]
    loadSnapshot(snap)
    const result = await importFitnotesCsv(file, { mode: "merge" })
    // Three file rows of 100 x 5: one is the saved set, two are new.
    expect(result.imported).toBe(4)
    const squat = currentSnapshot()
      .sets.filter((s) => s.workout_exercise_id === 10)
      .sort((a, b) => a.order - b.order)
    expect(squat.map((s) => [s.order, s.is_planned])).toEqual([
      [0, false],
      [3, true],
      [4, false],
      [5, false],
    ])
  })

  it("Replace clears day notes, the same as the JSON importer", async () => {
    const snap = blankSnapshot()
    snap.day_notes = [{ date: "2025-12-01", text: "old note" }]
    loadSnapshot(snap)
    await importFitnotesCsv(file, { mode: "replace" })
    expect(currentSnapshot().day_notes).toEqual([])

    loadSnapshot({ ...currentSnapshot(), day_notes: [{ date: "2025-12-01", text: "old note" }] })
    await importFitnotesCsv(HEADER + "\n", { mode: "replace" })
    expect(currentSnapshot().day_notes).toEqual([])
  })

  it("Merge keeps day notes", async () => {
    const snap = blankSnapshot()
    snap.day_notes = [{ date: "2025-12-01", text: "old note" }]
    loadSnapshot(snap)
    await importFitnotesCsv(file, { mode: "merge" })
    expect(currentSnapshot().day_notes).toEqual([{ date: "2025-12-01", text: "old note" }])
  })
})

/** A planned workout, and a done one with a planned set left over. */
function withPlans() {
  const snap = blankSnapshot()
  snap.exercises = [exercise(5001, "Zercher Squat", "legs"), exercise(5002, "Spoto Press")]
  snap.workouts = [workout(1, "2026-01-05", "Gym A", "done"), workout(2, "2026-01-12", "Gym A", "planned")]
  snap.workout_exercises = [we(10, 1, 5001, 0), we(11, 2, 5002, 0)]
  snap.sets = [
    set(100, 10, { weight: 100, reps: 5, order: 0 }),
    set(101, 10, { weight: 105, reps: 5, order: 1 }),
    set(102, 10, { weight: 110, reps: 5, order: 2, is_planned: true }),
    set(103, 11, { weight: 80, reps: 8, order: 0, is_planned: true }),
    set(104, 11, { weight: 80, reps: 8, order: 1, is_planned: true, note: "pause" }),
  ]
  snap.gyms = [{ id: 1, name: "Gym A" }]
  return snap
}

describe("JSON backup with planned work", () => {
  it("writes planned sets apart from logged ones, and the workout status", () => {
    const json = JSON.parse(buildJson(withPlans()))
    const [done, planned] = json.workouts
    expect(done.status).toBe("done")
    expect(planned.status).toBe("planned")
    // An older importer reads only `sets`, so a planned set must never be in it.
    expect(done.exercises[0].sets.map((s: { weight_kg: number }) => s.weight_kg)).toEqual([100, 105])
    expect(done.exercises[0].planned_sets.map((s: { weight_kg: number }) => s.weight_kg)).toEqual([110])
    expect(planned.exercises[0].sets).toEqual([])
    expect(planned.exercises[0].planned_sets).toHaveLength(2)
    expect(json.version).toBe(2)
  })

  it("restores planned workouts and planned sets", async () => {
    const text = buildJson(withPlans())
    const result = await importSnapshotJson(text, { mode: "replace" })
    expect(result.imported).toBe(2)
    const snap = currentSnapshot()
    const byDate = new Map(snap.workouts.map((w) => [w.date, w]))
    expect(byDate.get("2026-01-05")!.status).toBe("done")
    expect(byDate.get("2026-01-12")!.status).toBe("planned")
    const rows = (date: string) => {
      const w = byDate.get(date)!
      const weIds = new Set(snap.workout_exercises.filter((x) => x.workout_id === w.id).map((x) => x.id))
      return snap.sets
        .filter((s) => weIds.has(s.workout_exercise_id))
        .sort((a, b) => a.order - b.order)
        .map((s) => [s.weight, s.order, s.is_planned, s.note])
    }
    expect(rows("2026-01-05")).toEqual([
      [100, 0, false, ""],
      [105, 1, false, ""],
      [110, 2, true, ""],
    ])
    expect(rows("2026-01-12")).toEqual([
      [80, 0, true, ""],
      [80, 1, true, "pause"],
    ])
    // A planned set never holds a PR star.
    expect(snap.sets.filter((s) => s.is_planned).some((s) => s.is_pr || s.was_pr)).toBe(false)
  })

  it("a merge re-import adds no planned set twice", async () => {
    loadSnapshot(withPlans())
    const text = buildJson(withPlans())
    await importSnapshotJson(text, { mode: "merge" })
    expect(currentSnapshot().sets).toHaveLength(5)
  })

  it("does not bring back a planned set that was logged since the export", async () => {
    const text = buildJson(withPlans())
    const snap = withPlans()
    // The planned 110 x 5 was done as 110 x 4: same position, now logged.
    snap.sets = snap.sets.map((s) => (s.id === 102 ? { ...s, reps: 4, is_planned: false } : s))
    loadSnapshot(snap)
    await importSnapshotJson(text, { mode: "merge" })
    const squat = currentSnapshot().sets.filter((s) => s.workout_exercise_id === 10)
    expect(squat).toHaveLength(3)
    expect(squat.some((s) => s.is_planned)).toBe(false)
  })

  it("a file from before the status field still derives it", async () => {
    const payload = JSON.parse(buildJson(withPlans()))
    for (const w of payload.workouts) {
      delete w.status
      for (const e of w.exercises) delete e.planned_sets
    }
    await importSnapshotJson(JSON.stringify(payload), { mode: "replace" })
    const snap = currentSnapshot()
    expect(snap.workouts.map((w) => w.status)).toEqual(["done", "done"])
    expect(snap.sets.some((s) => s.is_planned)).toBe(false)
  })
})

describe("JSON backup with deleted custom exercises", () => {
  function withDeleted() {
    const snap = blankSnapshot()
    snap.exercises = [
      { ...exercise(5001, "Old Lift", "back"), is_deleted: true },
      exercise(5002, "Kept Lift", "chest"),
    ]
    snap.workouts = [workout(1, "2026-01-05")]
    snap.workout_exercises = [we(10, 1, 5001, 0), we(11, 1, 5002, 1)]
    snap.sets = [set(100, 10, { weight: 50, reps: 10 }), set(101, 11, { weight: 60, reps: 10 })]
    return snap
  }

  it("exports the deleted flag", () => {
    const json = JSON.parse(buildJson(withDeleted()))
    expect(json.custom_exercises).toEqual([
      { name: "Kept Lift", category: "chest", kind: "weight_reps" },
      { name: "Old Lift", category: "back", kind: "weight_reps", is_deleted: true },
    ])
  })

  it("keeps a deleted exercise deleted on import, with its sets on it", async () => {
    const result = await importSnapshotJson(buildJson(withDeleted()), { mode: "replace" })
    expect(result.exercisesCreated).toEqual(["Kept Lift"])
    const snap = currentSnapshot()
    const old = snap.exercises.filter((e) => e.name === "Old Lift")
    expect(old).toHaveLength(1)
    expect(old[0].is_deleted).toBe(true)
    // Its set came back on the deleted row, hidden as before the export.
    const weOld = snap.workout_exercises.find((x) => x.exercise_id === old[0].id)!
    expect(snap.sets.filter((s) => s.workout_exercise_id === weOld.id)).toHaveLength(1)
    expect(snap.exercises.find((e) => e.name === "Kept Lift")!.is_deleted).toBeFalsy()
  })

  it("does not delete a live exercise with the same name", async () => {
    const snap = blankSnapshot()
    snap.exercises = [exercise(6000, "Old Lift", "back")]
    loadSnapshot(snap)
    await importSnapshotJson(buildJson(withDeleted()), { mode: "merge" })
    const old = currentSnapshot().exercises.filter((e) => e.name === "Old Lift")
    expect(old).toHaveLength(1)
    expect(old[0].id).toBe(6000)
    expect(old[0].is_deleted).toBeFalsy()
  })

  it("reuses a matching deleted row already on the device", async () => {
    const snap = blankSnapshot()
    snap.exercises = [{ ...exercise(6000, "Old Lift", "back"), is_deleted: true }]
    loadSnapshot(snap)
    await importSnapshotJson(buildJson(withDeleted()), { mode: "merge" })
    const old = currentSnapshot().exercises.filter((e) => e.name === "Old Lift")
    expect(old.map((e) => [e.id, e.is_deleted])).toEqual([[6000, true]])
  })
})

describe("imported exercises with no stated kind", () => {
  it("a custom cardio exercise from a FitNotes CSV (no Kind column) is distance_time", async () => {
    const file = "Date,Exercise,Category,Weight (kg),Reps\n2026-01-01,Hill Climber Intervals,Cardio,20,5\n2026-01-01,Zercher Squat,Legs,100,5\n"
    await importFitnotesCsv(file, { mode: "merge" })
    const kinds = Object.fromEntries(currentSnapshot().exercises.map((e) => [e.name, e.kind]))
    expect(kinds["Hill Climber Intervals"]).toBe("distance_time")
    expect(kinds["Zercher Squat"]).toBe("weight_reps")
  })

  it("a JSON exercise with no kind gets the category's default", async () => {
    const text = JSON.stringify({ version: 2, workouts: [], custom_exercises: [{ name: "Rower", category: "cardio" }, { name: "Sled Push", category: "legs" }] })
    await importSnapshotJson(text, { mode: "merge" })
    const kinds = Object.fromEntries(currentSnapshot().exercises.map((e) => [e.name, e.kind]))
    expect(kinds["Rower"]).toBe("distance_time")
    expect(kinds["Sled Push"]).toBe("weight_reps")
  })
})
