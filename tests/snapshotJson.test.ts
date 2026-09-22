import { describe, it, expect, beforeEach } from "vitest"
import { buildJson } from "@lift/core/export"
import {
  previewSnapshotJson,
  importSnapshotJson,
} from "@lift/core/import"
import {
  installMemoryStorage,
  resetStore,
  loadSnapshot,
  currentSnapshot,
} from "./helpers/store"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"
import { SEED_EXERCISES } from "@lift/core/store/seed"

// Custom exercises only: names that are not built-in, so the round trip
// keeps them as custom rows. Built-in names are covered separately below.
function populated() {
  const snap = blankSnapshot()
  snap.exercises = [
    exercise(100, "Spoto Press", "chest"),
    exercise(101, "Zercher Squat", "legs"),
  ]
  snap.workouts = [
    workout(1, "2026-01-05", "Gym A", "done"),
    workout(2, "2026-01-12", "Gym A", "done"),
  ]
  snap.workout_exercises = [we(10, 1, 100, 0), we(11, 2, 101, 0)]
  snap.sets = [
    set(1000, 10, { weight: 100, reps: 5, order: 0 }),
    set(1001, 10, { weight: 105, reps: 5, order: 1 }),
    set(1002, 11, { weight: 140, reps: 3, order: 0 }),
  ]
  snap.gyms = [{ id: 1, name: "Gym A" }]
  return snap
}

beforeEach(() => {
  installMemoryStorage()
  resetStore()
})

describe("previewSnapshotJson", () => {
  it("recognizes a lift snapshot export", () => {
    const json = buildJson(populated())
    const p = previewSnapshotJson(json)
    expect(p.format).toBe("lift-snapshot")
    expect(p.workoutCount).toBe(2)
    expect(p.setCount).toBe(3)
  })

  it("flags invalid JSON as unknown", () => {
    const p = previewSnapshotJson("{ not json")
    expect(p.format).toBe("unknown")
    expect(p.reason).toMatch(/not valid JSON/i)
  })

  it("flags a structurally-wrong object as unknown", () => {
    const p = previewSnapshotJson(JSON.stringify({ hello: "world" }))
    expect(p.format).toBe("unknown")
  })
})

describe("importSnapshotJson round-trip", () => {
  it("re-imports an exported snapshot into an equivalent dataset", async () => {
    const json = buildJson(populated())

    // Fresh store, import in replace mode.
    resetStore()
    const result = await importSnapshotJson(json, { mode: "replace" })

    expect(result.imported).toBe(3)
    const snap = currentSnapshot()
    expect(snap.workouts).toHaveLength(2)
    expect(snap.sets).toHaveLength(3)
    expect(snap.exercises.map((e) => e.name).sort()).toEqual([
      "Spoto Press",
      "Zercher Squat",
    ])
    expect(snap.gyms.map((g) => g.name)).toContain("Gym A")
    // PR pass ran on import
    expect(snap.sets.some((s) => s.is_pr)).toBe(true)
  })

  it("round-trips day notes, including a note-only day", async () => {
    const snap = populated()
    snap.day_notes = [
      { date: "2026-01-05", text: "felt strong" },
      { date: "2026-01-06", text: "rest day" },
    ]
    const json = buildJson(snap)
    resetStore()
    await importSnapshotJson(json, { mode: "replace" })
    expect(currentSnapshot().day_notes).toEqual([
      { date: "2026-01-05", text: "felt strong" },
      { date: "2026-01-06", text: "rest day" },
    ])
    expect(currentSnapshot().workouts.some((w) => w.date === "2026-01-06")).toBe(
      false
    )
  })

  it("lifts workout.notes into day_notes when importing an older export", async () => {
    const payload = JSON.parse(buildJson(populated()))
    delete payload.day_notes
    payload.version = 1
    payload.workouts[0].notes = "legacy note"
    resetStore()
    await importSnapshotJson(JSON.stringify(payload), { mode: "replace" })
    expect(currentSnapshot().day_notes).toEqual([
      { date: "2026-01-05", text: "legacy note" },
    ])
    expect(
      currentSnapshot().workouts.find((w) => w.date === "2026-01-05")?.notes
    ).toBe("")
  })

  it("round-trips a workout note without touching the day note", async () => {
    const snap = populated()
    snap.day_notes = [{ date: "2026-01-05", text: "slept badly" }]
    snap.workouts[0].notes = "dropped to 3x5"
    const json = buildJson(snap)
    resetStore()
    await importSnapshotJson(json, { mode: "replace" })
    expect(currentSnapshot().day_notes).toEqual([
      { date: "2026-01-05", text: "slept badly" },
    ])
    expect(
      currentSnapshot().workouts.find((w) => w.date === "2026-01-05")?.notes
    ).toBe("dropped to 3x5")
  })

  it("round-trips an exercise note alongside the day and session notes", async () => {
    const snap = populated()
    snap.day_notes = [{ date: "2026-01-05", text: "slept badly" }]
    snap.workouts[0].notes = "short session"
    snap.workout_exercises[0].note = "felt heavy, dropped to 60kg"
    const json = buildJson(snap)
    resetStore()
    await importSnapshotJson(json, { mode: "replace" })

    const after = currentSnapshot()
    expect(after.day_notes).toEqual([
      { date: "2026-01-05", text: "slept badly" },
    ])
    expect(after.workouts.find((w) => w.date === "2026-01-05")?.notes).toBe(
      "short session"
    )
    expect(after.workout_exercises.map((we) => we.note)).toContain(
      "felt heavy, dropped to 60kg"
    )
  })

  it("merge mode is idempotent: re-importing the same file adds nothing", async () => {
    const json = buildJson(populated())
    resetStore()
    await importSnapshotJson(json, { mode: "merge" })
    const afterFirst = currentSnapshot().sets.length
    await importSnapshotJson(json, { mode: "merge" })
    expect(currentSnapshot().sets.length).toBe(afterFirst)
  })

  it("returns an error envelope for a non-snapshot file", async () => {
    resetStore()
    const result = await importSnapshotJson("garbage", { mode: "merge" })
    expect(result.imported).toBe(0)
    expect(result.errors[0].message).toMatch(/not a valid JSON snapshot/i)
  })
})

function seedId(name: string): number {
  const row = SEED_EXERCISES.find((e) => e.name === name)
  if (!row) throw new Error(`no built-in exercise ${name}`)
  return row.id
}

/** A snapshot whose workouts only use built-in exercises: no rows in
 *  `exercises` at all, the way the app stores them. */
function usingBuiltIns() {
  const snap = blankSnapshot()
  snap.workouts = [
    workout(1, "2026-01-05", "Gym A", "done"),
    workout(2, "2026-01-07", "Gym A", "done"),
  ]
  snap.workout_exercises = [
    we(10, 1, seedId("Bench Press"), 0),
    we(11, 1, seedId("Deadlift"), 1),
    we(12, 2, seedId("Treadmill"), 0),
  ]
  snap.sets = [
    set(1000, 10, { weight: 100, reps: 5, order: 0 }),
    set(1001, 11, { weight: 180, reps: 3, order: 0 }),
    set(1002, 12, { weight: 20, reps: 5, order: 0 }),
  ]
  snap.gyms = [{ id: 1, name: "Gym A" }]
  return snap
}

function exerciseIdsBySetWeight() {
  const snap = currentSnapshot()
  const weById = new Map(snap.workout_exercises.map((x) => [x.id, x]))
  return Object.fromEntries(
    snap.sets.map((s) => [s.weight, weById.get(s.workout_exercise_id)?.exercise_id])
  )
}

describe("importSnapshotJson with built-in exercises", () => {
  for (const mode of ["replace", "merge"] as const) {
    it(`maps built-in names to their built-in ids (${mode})`, async () => {
      const json = buildJson(usingBuiltIns())
      resetStore()
      const result = await importSnapshotJson(json, { mode })

      expect(result.imported).toBe(3)
      expect(result.exercisesCreated).toEqual([])
      expect(currentSnapshot().exercises).toEqual([])
      expect(exerciseIdsBySetWeight()).toEqual({
        100: seedId("Bench Press"),
        180: seedId("Deadlift"),
        20: seedId("Treadmill"),
      })
    })
  }

  it("matches built-in names case-insensitively", async () => {
    const payload = JSON.parse(buildJson(usingBuiltIns()))
    payload.workouts[0].exercises[0].exercise.name = "bench PRESS"
    resetStore()
    const result = await importSnapshotJson(JSON.stringify(payload), { mode: "replace" })
    expect(result.exercisesCreated).toEqual([])
    expect(exerciseIdsBySetWeight()[100]).toBe(seedId("Bench Press"))
  })

  it("folds a custom row that has a built-in name into the built-in", async () => {
    // What the old importer left behind: a custom "Bench Press" next to the
    // built-in one. Re-importing an export of it cleans the duplicate up.
    const snap = usingBuiltIns()
    snap.exercises = [exercise(500, "Bench Press", "chest")]
    snap.workout_exercises[0] = we(10, 1, 500, 0)
    const json = buildJson(snap)
    resetStore()
    const result = await importSnapshotJson(json, { mode: "replace" })
    expect(result.exercisesCreated).toEqual([])
    expect(currentSnapshot().exercises).toEqual([])
    expect(exerciseIdsBySetWeight()[100]).toBe(seedId("Bench Press"))
  })

  it("in merge mode, an existing custom row with a built-in name still wins", async () => {
    // A user whose data already has its own "Deadlift" keeps getting it, so
    // merging a file never splits one lift's history across two rows.
    const existing = blankSnapshot()
    existing.exercises = [exercise(700, "Deadlift", "back")]
    loadSnapshot(existing)
    await importSnapshotJson(buildJson(usingBuiltIns()), { mode: "merge" })
    expect(exerciseIdsBySetWeight()[180]).toBe(700)
    expect(exerciseIdsBySetWeight()[100]).toBe(seedId("Bench Press"))
  })

  it("does not match a built-in by its old name once the user renamed it", async () => {
    const existing = blankSnapshot()
    const benchId = seedId("Bench Press")
    // A rename of a built-in is stored as an override row with the seed id.
    existing.exercises = [{ ...exercise(benchId, "Flat Bench", "chest"), is_custom: false }]
    loadSnapshot(existing)
    const result = await importSnapshotJson(buildJson(usingBuiltIns()), { mode: "merge" })
    // The rename hides the built-in name here, the same way the exercise
    // list does. So the file's "Bench Press" becomes a new exercise instead
    // of landing under "Flat Bench" without the user knowing.
    expect(result.exercisesCreated).toEqual(["Bench Press"])
  })

  it("a time-only exercise with a built-in's name stays time-only", async () => {
    const payload = JSON.parse(buildJson(usingBuiltIns()))
    payload.workouts[0].exercises[0].exercise = {
      name: "Plank",
      category: "abs",
      kind: "time_only",
      is_custom: true,
    }
    payload.custom_exercises = [{ name: "Plank", category: "abs", kind: "time_only" }]
    resetStore()
    const result = await importSnapshotJson(JSON.stringify(payload), { mode: "replace" })
    expect(result.exercisesCreated).toEqual(["Plank"])
    const plank = currentSnapshot().exercises.find((e) => e.name === "Plank")!
    expect(plank.kind).toBe("time_only")
    expect(plank.id).not.toBe(seedId("Plank"))
    expect(currentSnapshot().exercises.filter((e) => e.name === "Plank")).toHaveLength(1)
  })

  it("collapses spacing in names, the same as the CSV importer", async () => {
    const payload = JSON.parse(buildJson(usingBuiltIns()))
    payload.workouts[0].exercises[0].exercise.name = "  Bench   Press "
    resetStore()
    const result = await importSnapshotJson(JSON.stringify(payload), { mode: "replace" })
    expect(result.exercisesCreated).toEqual([])
    expect(exerciseIdsBySetWeight()[100]).toBe(seedId("Bench Press"))
  })

  it("does not attach sets to a deleted built-in", async () => {
    const benchId = seedId("Bench Press")
    const existing = blankSnapshot()
    existing.exercises = [{ ...exercise(benchId, "Bench Press", "chest"), is_custom: false, is_deleted: true }]
    loadSnapshot(existing)
    const result = await importSnapshotJson(buildJson(usingBuiltIns()), { mode: "merge" })
    expect(result.exercisesCreated).toEqual(["Bench Press"])
    expect(exerciseIdsBySetWeight()[100]).not.toBe(benchId)
  })

  it("a merge re-import of a built-in export adds nothing", async () => {
    const json = buildJson(usingBuiltIns())
    resetStore()
    await importSnapshotJson(json, { mode: "merge" })
    const sets = currentSnapshot().sets.length
    const result = await importSnapshotJson(json, { mode: "merge" })
    expect(result.imported).toBe(0)
    expect(currentSnapshot().sets.length).toBe(sets)
    expect(currentSnapshot().exercises).toEqual([])
  })
})
