import { describe, it, expect } from "vitest"
import { gzipSync } from "fflate"
import { serialize, parse } from "@lift/core/store/blob"
import { SCHEMA_VERSION, emptySnapshot } from "@lift/core/store/schema"

function gzipJson(obj: unknown): Uint8Array {
  return gzipSync(new TextEncoder().encode(JSON.stringify(obj)))
}

describe("blob: serialize/parse round-trip", () => {
  it("preserves the snapshot contents through gzip", async () => {
    const snap = emptySnapshot("dev-1")
    snap.exercises.push({
      id: 101,
      name: "Custom Lift",
      category: "back",
      kind: "weight_reps",
      is_custom: true,
    })
    snap.settings.weight_unit = "kg"

    const bytes = await serialize(snap)
    const { snapshot, migrated } = await parse(bytes)

    expect(migrated).toBe(false)
    expect(snapshot.schema_version).toBe(SCHEMA_VERSION)
    expect(snapshot.exercises).toHaveLength(1)
    expect(snapshot.exercises[0].name).toBe("Custom Lift")
    expect(snapshot.settings.weight_unit).toBe("kg")
  })

  it("stamps the current schema version on serialize", async () => {
    const snap = emptySnapshot("dev-1")
    // pretend it came in tagged with an old version
    ;(snap as { schema_version: number }).schema_version = 1
    const bytes = await serialize(snap)
    const { snapshot } = await parse(bytes)
    expect(snapshot.schema_version).toBe(SCHEMA_VERSION)
  })
})

describe("blob: migrations", () => {
  it("migrates a v1 snapshot: infers kind and backfills set fields", async () => {
    const v1 = {
      schema_version: 1,
      exported_at: "2025-01-01T00:00:00.000Z",
      device_id: "old",
      settings: { weight_unit: "lb", first_day_of_week: 0 },
      exercises: [
        { id: 1, name: "Bench", category: "chest", is_custom: false },
        { id: 2, name: "Run", category: "cardio", is_custom: false },
      ],
      workouts: [],
      workout_exercises: [],
      sets: [
        {
          id: 1,
          workout_exercise_id: 1,
          weight: 100,
          reps: 5,
          is_planned: false,
          is_pr: false,
          was_pr: false,
          note: "",
          order: 0,
          created_at: "2025-01-01T00:00:00.000Z",
        },
      ],
      gyms: [],
    }

    const { snapshot, migrated } = await parse(gzipJson(v1))

    expect(migrated).toBe(true)
    expect(snapshot.schema_version).toBe(SCHEMA_VERSION)
    // kind inferred from category
    expect(snapshot.exercises[0].kind).toBe("weight_reps")
    expect(snapshot.exercises[1].kind).toBe("distance_time")
    // v2 set fields backfilled
    expect(snapshot.sets[0].distance_m).toBeNull()
    expect(snapshot.sets[0].distance_unit_display).toBe("")
    expect(snapshot.sets[0].time_seconds).toBeNull()
    // v4 position-pr flags backfilled
    expect(snapshot.sets[0].is_position_pr).toBe(false)
    expect(snapshot.sets[0].was_position_pr).toBe(false)
  })

  it("migrates a v3 snapshot by adding position-pr flags only", async () => {
    const v3 = {
      schema_version: 3,
      exported_at: "2025-06-01T00:00:00.000Z",
      device_id: "old",
      settings: { weight_unit: "kg", first_day_of_week: 1 },
      exercises: [
        { id: 1, name: "Squat", category: "legs", kind: "weight_reps", is_custom: false },
      ],
      workouts: [],
      workout_exercises: [],
      sets: [
        {
          id: 1,
          workout_exercise_id: 1,
          weight: 140,
          reps: 3,
          distance_m: null,
          distance_unit_display: "",
          time_seconds: null,
          is_planned: false,
          is_pr: true,
          was_pr: true,
          note: "",
          order: 0,
          created_at: "2025-06-01T00:00:00.000Z",
        },
      ],
      gyms: [],
    }

    const { snapshot, migrated } = await parse(gzipJson(v3))

    expect(migrated).toBe(true)
    expect(snapshot.sets[0].is_pr).toBe(true) // preserved
    expect(snapshot.sets[0].is_position_pr).toBe(false) // backfilled
    expect(snapshot.sets[0].was_position_pr).toBe(false)
  })

  it("does not mark a current-version snapshot as migrated", async () => {
    const cur = emptySnapshot("dev")
    const { migrated } = await parse(gzipJson(cur))
    expect(migrated).toBe(false)
  })

  it("rejects a snapshot from a newer schema version", async () => {
    const future = { ...emptySnapshot("dev"), schema_version: SCHEMA_VERSION + 1 }
    await expect(parse(gzipJson(future))).rejects.toThrow(/newer than supported/)
  })
})
