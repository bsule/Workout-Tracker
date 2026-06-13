import { describe, it, expect } from "vitest"
import { buildCsv, buildJson, timestampedExportName } from "@lift/core/export"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

function sample() {
  const snap = blankSnapshot()
  snap.exercises = [exercise(100, "Bench, Press", "chest")] // comma to test escaping
  snap.workouts = [workout(1, "2026-01-05", "Gym A", "done")]
  snap.workout_exercises = [we(10, 1, 100, 0)]
  snap.sets = [
    set(1000, 10, { weight: 100, reps: 5, order: 0, is_pr: true }),
    set(1001, 10, { weight: 60, reps: 5, order: 1, is_planned: true }), // excluded
  ]
  snap.gyms = [{ id: 1, name: "Gym A" }]
  return snap
}

describe("buildCsv", () => {
  it("emits a header plus one row per logged (non-planned) set", () => {
    const lines = buildCsv(sample()).trim().split("\n")
    expect(lines[0]).toContain("date,exercise,category,kind")
    expect(lines).toHaveLength(2) // header + 1 logged set
  })

  it("escapes commas in field values", () => {
    const csv = buildCsv(sample())
    expect(csv).toContain('"Bench, Press"')
  })

  it("renders booleans as 1/0", () => {
    const row = buildCsv(sample()).trim().split("\n")[1]
    // is_pr column is "1"
    expect(row).toContain(",1,")
  })
})

describe("buildJson", () => {
  it("produces a versioned snapshot payload with nested workouts", () => {
    const json = JSON.parse(buildJson(sample(), "tester"))
    expect(json.version).toBe(1)
    expect(json.weight_unit).toBe("kg")
    expect(json.user.username).toBe("tester")
    expect(json.workouts).toHaveLength(1)
    expect(json.workouts[0].exercises[0].exercise.name).toBe("Bench, Press")
  })

  it("excludes planned sets from the export", () => {
    const json = JSON.parse(buildJson(sample()))
    const sets = json.workouts[0].exercises[0].sets
    expect(sets).toHaveLength(1)
    expect(sets[0].weight_kg).toBe(100)
  })

  it("lists custom exercises and saved gyms", () => {
    const json = JSON.parse(buildJson(sample()))
    expect(json.custom_exercises.map((e: { name: string }) => e.name)).toContain(
      "Bench, Press"
    )
    expect(json.saved_gyms).toContain("Gym A")
  })
})

describe("timestampedExportName", () => {
  it("builds a dated filename with the right extension", () => {
    expect(timestampedExportName("csv")).toMatch(/^lift-export-.*\.csv$/)
    expect(timestampedExportName("json")).toMatch(/^lift-export-.*\.json$/)
  })
})
