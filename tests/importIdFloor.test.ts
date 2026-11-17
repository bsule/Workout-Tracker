import { beforeEach, expect, it } from "vitest"
import { importFitnotesCsv, importSnapshotJson } from "@lift/core/import"
import { FIRST_CUSTOM_ID, SEED_EXERCISES } from "@lift/core/store/seed"
import { createExercise } from "@lift/core/store/mutations"
import { installMemoryStorage, resetStore, currentSnapshot } from "./helpers/store"

// This file runs in its own module scope, so the id counter starts at 1, below
// the seed catalog: the case where an imported custom exercise used to take a
// built-in exercise's id. The Rust importer applies the same floor.
beforeEach(() => {
  installMemoryStorage()
  resetStore()
})

const HEADER = "Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind"

function customIds() {
  return currentSnapshot().exercises.filter((e) => e.is_custom).map((e) => e.id)
}

// First in the file on purpose: no earlier case has floored the counter yet.
it("floors an exercise a JSON workout introduces above the seed catalog", async () => {
  const text = JSON.stringify({
    version: 2,
    custom_exercises: [],
    workouts: [
      {
        date: "2026-01-01",
        exercises: [
          { exercise: { name: "Landmine Press", category: "shoulders", kind: "weight_reps" }, sets: [{ weight_kg: 40, reps: 8 }] },
        ],
      },
    ],
  })
  await importSnapshotJson(text, { mode: "merge" })
  const snap = currentSnapshot()
  const row = snap.exercises.find((e) => e.name === "Landmine Press")!
  expect(row.id).toBeGreaterThanOrEqual(FIRST_CUSTOM_ID)
  expect(SEED_EXERCISES.some((e) => e.id === row.id)).toBe(false)
  // Every built-in is still listed under its own name, and the set points at
  // the new row.
  const we = snap.workout_exercises[0]
  expect(we.exercise_id).toBe(row.id)
})

it("floors new exercises from a FitNotes CSV above the seed catalog", async () => {
  await importFitnotesCsv(
    [HEADER, "2026-01-01,Zercher Squat,Legs,100,,5,,,,,wr", "2026-01-01,Spoto Press,Chest,80,,5,,,,,wr"].join("\n")
  )
  const ids = customIds()
  expect(ids).toHaveLength(2)
  for (const id of ids) expect(id).toBeGreaterThanOrEqual(FIRST_CUSTOM_ID)
  expect(new Set(ids).size).toBe(2)
  const seedIds = new Set(SEED_EXERCISES.map((e) => e.id))
  for (const id of ids) expect(seedIds.has(id)).toBe(false)
})

it("floors custom exercises from a JSON export above the seed catalog", async () => {
  const text = JSON.stringify({
    version: 2,
    custom_exercises: [
      { name: "Meadows Row", category: "back", kind: "weight_reps" },
      { name: "Pin Press", category: "chest", kind: "weight_reps" },
    ],
    workouts: [],
    day_notes: [],
  })
  await importSnapshotJson(text, { mode: "merge" })
  const ids = customIds()
  expect(ids).toHaveLength(2)
  for (const id of ids) expect(id).toBeGreaterThanOrEqual(FIRST_CUSTOM_ID)
  expect(new Set(ids).size).toBe(2)
})

it("never hands two custom exercises the same floored id", () => {
  const a = createExercise({ name: "First Custom", category: "chest" })
  const b = createExercise({ name: "Second Custom", category: "chest" })
  expect(a.id).toBeGreaterThanOrEqual(FIRST_CUSTOM_ID)
  expect(b.id).toBeGreaterThan(a.id)
})
