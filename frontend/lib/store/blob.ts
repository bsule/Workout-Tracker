import { SCHEMA_VERSION, type Snapshot } from "./schema"

async function gzip(input: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([new Uint8Array(input)])
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([new Uint8Array(input)])
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
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
