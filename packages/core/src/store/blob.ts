import { gzipSync, gunzipSync } from "fflate"
import { SCHEMA_VERSION, type Snapshot } from "./schema"

// Use fflate's *synchronous* API on purpose — the async variants spin up a
// Web Worker, which doesn't exist in React Native, and the platform
// CompressionStream / `new Blob([Uint8Array])` path also fails on RN.
// gzipSync runs on the JS thread; snapshots are small enough that this
// hasn't been a perf problem in practice.
function gzip(input: Uint8Array): Promise<Uint8Array> {
  return Promise.resolve(gzipSync(input))
}

function gunzip(input: Uint8Array): Promise<Uint8Array> {
  return Promise.resolve(gunzipSync(input))
}

export async function serialize(snap: Snapshot): Promise<Uint8Array> {
  const stamped: Snapshot = {
    ...snap,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
  }
  const json = JSON.stringify(stamped)
  const bytes = new TextEncoder().encode(json)
  return gzip(bytes)
}

export async function parse(bytes: Uint8Array): Promise<Snapshot> {
  const raw = await gunzip(bytes)
  const json = new TextDecoder().decode(raw)
  const obj = JSON.parse(json) as Snapshot
  return migrate(obj)
}

function migrate(snap: Snapshot): Snapshot {
  const v = snap.schema_version ?? 0
  if (v > SCHEMA_VERSION) {
    throw new Error(
      `Snapshot schema_version ${v} is newer than supported ${SCHEMA_VERSION}`
    )
  }
  let s = snap
  if (v < 2) {
    // v1 → v2: add kind to exercises (default by category), add nullable
    // distance/time fields to sets. Existing fields take precedence in the
    // unlikely case they're already present on the row.
    s = {
      ...s,
      exercises: s.exercises.map((e) => ({
        ...e,
        kind:
          e.kind ?? (e.category === "cardio" ? "distance_time" : "weight_reps"),
      })),
      sets: s.sets.map((row) => ({
        ...row,
        distance_m: row.distance_m ?? null,
        distance_unit_display: row.distance_unit_display ?? "",
        time_seconds: row.time_seconds ?? null,
      })),
    }
  }
  return { ...s, schema_version: SCHEMA_VERSION }
}
