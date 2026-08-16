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

export interface ParseResult {
  snapshot: Snapshot
  migrated: boolean
}

export async function parse(bytes: Uint8Array): Promise<ParseResult> {
  const raw = await gunzip(bytes)
  const json = new TextDecoder().decode(raw)
  const obj = JSON.parse(json) as Snapshot
  return migrate(obj)
}

function migrate(snap: Snapshot): ParseResult {
  const v = snap.schema_version ?? 0
  if (v > SCHEMA_VERSION) {
    throw new Error(
      `Snapshot schema_version ${v} is newer than supported ${SCHEMA_VERSION}`
    )
  }
  let s = snap
  let migrated = v < SCHEMA_VERSION
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
  if (v < 4) {
    s = {
      ...s,
      sets: s.sets.map((row) => ({
        ...row,
        is_position_pr: row.is_position_pr ?? false,
        was_position_pr: row.was_position_pr ?? false,
      })),
    }
  }
  if (v < 5) {
    // v4 → v5: lift per-workout notes onto the date. Empty / whitespace-only
    // notes are dropped so we don't keep blank rows. If a snapshot already
    // has day_notes (hand-built / partial), keep those and only fill gaps.
    const existing = new Map(
      (s.day_notes ?? []).map((n) => [n.date, n.text] as const)
    )
    for (const w of s.workouts) {
      const text = (w.notes ?? "").trim()
      if (!text || existing.has(w.date)) continue
      existing.set(w.date, text)
    }
    s = {
      ...s,
      day_notes: [...existing].map(([date, text]) => ({ date, text })),
    }
  }
  // workout.notes is no longer canonical. Blank leftovers so a deleted day
  // note cannot resurrect on export, and empty-workout cleanup (`!w.notes`)
  // still treats picker-created days as disposable. Do not copy leftovers
  // on already-v5 snapshots — the user may have cleared the day note.
  if (s.workouts.some((w) => w.notes)) {
    s = {
      ...s,
      workouts: s.workouts.map((w) => (w.notes ? { ...w, notes: "" } : w)),
    }
    migrated = true
  }
  return {
    snapshot: { ...s, schema_version: SCHEMA_VERSION },
    migrated,
  }
}
