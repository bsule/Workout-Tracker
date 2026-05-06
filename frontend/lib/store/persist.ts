import { parse, serialize } from "./blob"
import { newDeviceId } from "./ids"
import { emptySnapshot, type Snapshot } from "./schema"
import { pickStorage, type BlobStorage } from "./storage"
import { clearDirty, getState, markHydrated } from "./store"

let storage: BlobStorage | null = null
let storageKey: string | null = null
let hydratePromise: Promise<void> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let visibilityWired = false
let pendingRecordingPaused = 0 // refcount; >0 disables crash log appends.
let consecutiveFlushFailures = 0
let flushInFlight = false
const FLUSH_DEBOUNCE_MS = 5000
// Exponential backoff for retrying failed flushes — 1s, 2s, 4s, 8s, 16s,
// then capped. Each successful flush resets the counter.
const FLUSH_RETRY_BASE_MS = 1000
const FLUSH_RETRY_MAX_MS = 16000

export function configure(subPath: string) {
  if (storageKey === subPath) return
  storage = pickStorage(subPath)
  storageKey = subPath
  hydratePromise = null
}

function ensureStorage(): BlobStorage {
  if (!storage) {
    storage = pickStorage("default")
    storageKey = "default"
  }
  return storage
}

export async function hydrate(): Promise<void> {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    const s = ensureStorage()
    const bytes = await s.readSnapshot()
    let snap: Snapshot
    if (bytes) {
      try {
        snap = await parse(bytes)
      } catch (e) {
        console.error("Failed to parse snapshot, starting fresh", e)
        snap = emptySnapshot(newDeviceId())
      }
    } else {
      snap = emptySnapshot(newDeviceId())
    }

    const pending = await s.readPending()
    if (pending.length > 0) {
      snap = applyPendingOps(snap, pending)
    }

    markHydrated(snap)

    if (pending.length > 0) {
      // Persist replayed state and clear the log.
      await flushNow()
    } else {
      // Always make sure we have a snapshot on disk for next launch.
      if (!bytes) await flushNow()
    }

    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      try {
        await navigator.storage.persist()
      } catch {
        // Best-effort; ignore.
      }
    }

    wireVisibility()
  })()
  return hydratePromise
}

export function recordPending(op: unknown) {
  if (typeof window === "undefined") return
  if (pendingRecordingPaused > 0) {
    // Bulk operation in flight — caller is responsible for flushNow() at the
    // end. Skipping the per-op append avoids O(n²) reads for large imports.
    scheduleFlush()
    return
  }
  const s = ensureStorage()
  const line = JSON.stringify(op)
  // Fire-and-forget; ordering preserved because storage adapters serialize.
  s.appendPending(line).catch((e) =>
    console.error("Failed to append pending op", e)
  )
  scheduleFlush()
}

/**
 * Run a function with the per-op crash log disabled. The in-memory snapshot
 * is still updated normally — caller MUST call flushNow() afterwards (or
 * accept that the 5s debounced flush will eventually fire). Useful for bulk
 * imports where appending 10k lines individually is O(n²).
 */
export async function runBatched<T>(fn: () => Promise<T> | T): Promise<T> {
  pendingRecordingPaused++
  try {
    return await fn()
  } finally {
    pendingRecordingPaused--
  }
}

function scheduleFlush(delay = FLUSH_DEBOUNCE_MS) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, delay)
}

/**
 * Persist the in-memory snapshot to storage. Resilient to transient I/O
 * failures: on error, schedules a retry with exponential backoff so the
 * user's data isn't permanently lost just because (e.g.) IDB threw a
 * QuotaExceededError or a transient transaction abort. Successful flushes
 * reset the failure counter.
 */
export async function flushNow(): Promise<void> {
  if (flushInFlight) return
  const s = ensureStorage()
  const { snapshot, hydrated } = getState()
  if (!hydrated) return
  flushInFlight = true
  try {
    const bytes = await serialize(snapshot)
    await s.writeSnapshot(bytes)
    await s.clearPending()
    clearDirty()
    consecutiveFlushFailures = 0
  } catch (e) {
    consecutiveFlushFailures += 1
    const delay = Math.min(
      FLUSH_RETRY_BASE_MS * 2 ** (consecutiveFlushFailures - 1),
      FLUSH_RETRY_MAX_MS
    )
    console.error(
      `Failed to flush snapshot (attempt ${consecutiveFlushFailures}, retrying in ${delay}ms)`,
      e
    )
    scheduleFlush(delay)
  } finally {
    flushInFlight = false
  }
}

function wireVisibility() {
  if (visibilityWired || typeof window === "undefined") return
  visibilityWired = true
  const onHide = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    void flushNow()
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide()
  })
  window.addEventListener("pagehide", onHide)
}

// ---- pending op replay -------------------------------------------

interface OpEnvelope {
  op: string
  [k: string]: unknown
}

function applyPendingOps(snap: Snapshot, lines: string[]): Snapshot {
  let out = snap
  for (const line of lines) {
    let parsed: OpEnvelope
    try {
      parsed = JSON.parse(line) as OpEnvelope
    } catch {
      continue
    }
    out = applyOne(out, parsed)
  }
  return out
}

function applyOne(snap: Snapshot, op: OpEnvelope): Snapshot {
  switch (op.op) {
    case "update_settings": {
      const patch = op.patch as Partial<Snapshot["settings"]>
      return { ...snap, settings: { ...snap.settings, ...patch } }
    }
    case "create_exercise": {
      const row = op.row as Snapshot["exercises"][number]
      if (snap.exercises.some((e) => e.id === row.id)) return snap
      return { ...snap, exercises: [...snap.exercises, row] }
    }
    case "patch_exercise": {
      const id = op.id as number
      const row = op.row as Snapshot["exercises"][number] | undefined
      if (row && !snap.exercises.some((e) => e.id === id)) {
        return { ...snap, exercises: [...snap.exercises, row] }
      }
      const patch =
        row ?? (op.patch as Partial<Snapshot["exercises"][number]>)
      return {
        ...snap,
        exercises: snap.exercises.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      }
    }
    case "delete_exercise": {
      const id = op.id as number
      const row = op.row as Snapshot["exercises"][number] | null | undefined
      if (row && !snap.exercises.some((e) => e.id === id)) {
        return { ...snap, exercises: [...snap.exercises, row] }
      }
      return {
        ...snap,
        exercises: snap.exercises.map((e) =>
          e.id === id ? { ...e, is_deleted: true } : e
        ),
      }
    }
    case "create_workout": {
      const row = op.row as Snapshot["workouts"][number]
      if (snap.workouts.some((w) => w.id === row.id)) return snap
      return { ...snap, workouts: [...snap.workouts, row] }
    }
    case "delete_workout": {
      const id = op.id as number
      const wes = snap.workout_exercises.filter((we) => we.workout_id === id)
      const weIds = new Set(wes.map((we) => we.id))
      return {
        ...snap,
        workouts: snap.workouts.filter((w) => w.id !== id),
        workout_exercises: snap.workout_exercises.filter(
          (we) => we.workout_id !== id
        ),
        sets: snap.sets.filter((s) => !weIds.has(s.workout_exercise_id)),
      }
    }
    case "patch_workout": {
      const id = op.id as number
      const patch = op.patch as Partial<Snapshot["workouts"][number]>
      return {
        ...snap,
        workouts: snap.workouts.map((w) =>
          w.id === id ? { ...w, ...patch } : w
        ),
      }
    }
    case "add_exercise": {
      const row = op.row as Snapshot["workout_exercises"][number]
      if (snap.workout_exercises.some((we) => we.id === row.id)) return snap
      return {
        ...snap,
        workout_exercises: [...snap.workout_exercises, row],
      }
    }
    case "remove_exercise": {
      const weId = op.weId as number
      return {
        ...snap,
        workout_exercises: snap.workout_exercises.filter((we) => we.id !== weId),
        sets: snap.sets.filter((s) => s.workout_exercise_id !== weId),
      }
    }
    case "add_set": {
      const row = op.row as Snapshot["sets"][number]
      if (snap.sets.some((s) => s.id === row.id)) return snap
      return { ...snap, sets: [...snap.sets, row] }
    }
    case "log_planned_set":
    case "update_set": {
      const setId = op.setId as number
      const patch = op.patch as Partial<Snapshot["sets"][number]>
      const flip = op.op === "log_planned_set"
      return {
        ...snap,
        sets: snap.sets.map((s) =>
          s.id === setId
            ? {
                ...s,
                ...patch,
                ...(flip
                  ? { is_planned: false, created_at: new Date().toISOString() }
                  : {}),
              }
            : s
        ),
      }
    }
    case "delete_set": {
      const setId = op.setId as number
      return { ...snap, sets: snap.sets.filter((s) => s.id !== setId) }
    }
    case "create_gym": {
      const row = op.row as Snapshot["gyms"][number]
      if (snap.gyms.some((g) => g.id === row.id)) return snap
      return { ...snap, gyms: [...snap.gyms, row] }
    }
    case "delete_gym": {
      const id = op.id as number
      return { ...snap, gyms: snap.gyms.filter((g) => g.id !== id) }
    }
    case "copy_from":
    case "recompute_prs":
      // These operations are best replayed by the snapshot itself; the
      // snapshot is already consistent because the in-memory store wrote
      // through. If we lost the snapshot but kept the log, accept some
      // best-effort behavior here.
      return snap
    default:
      return snap
  }
}
