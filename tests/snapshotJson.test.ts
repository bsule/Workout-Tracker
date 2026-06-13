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

function populated() {
  const snap = blankSnapshot()
  snap.exercises = [
    exercise(100, "Bench Press", "chest"),
    exercise(101, "Back Squat", "legs"),
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
      "Back Squat",
      "Bench Press",
    ])
    expect(snap.gyms.map((g) => g.name)).toContain("Gym A")
    // PR pass ran on import
    expect(snap.sets.some((s) => s.is_pr)).toBe(true)
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
