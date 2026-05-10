/**
 * Manual sync orchestration. The app is local-first by default; the user
 * triggers a round-trip from a Settings button. Server enforces a daily
 * push budget (5/day at the time of writing).
 *
 * Flow on click:
 *   1. Push the in-memory snapshot. ETag/If-Match from the transport.
 *   2. On 200 → done.
 *   3. On 412 (stale) → pull remote, replace local. The user's unsynced
 *      local edits are lost; this matches the conflict policy.
 *   4. On 429 (over quota) → throw SyncQuotaExceededError so UI can show
 *      "X uses today, resets at Y".
 *
 * Pulls (and quota fetches) are unrestricted, so reading remaining quota
 * for the UI is free.
 */

import { parse } from "../store/blob"
import { replaceSnapshotFromBytes } from "../store/persist"
import { getState } from "../store/store"
import {
  _internalPullBytes,
  getTransport,
  isSyncConfigured,
  pushNow,
} from "./index"
import {
  CloudflareTransport,
  StaleSnapshotError,
  SyncQuotaExceededError,
  type Quota,
} from "./cloudflareTransport"

export type SyncOutcome =
  | { kind: "pushed"; quota: Quota | null }
  | { kind: "pulled-on-stale" }

export interface RemotePreview {
  exportedAt: string | null
  workoutCount: number
  setCount: number
  customExerciseCount: number
  gymCount: number
  bytes: Uint8Array
}

/**
 * Run a full sync. Push first; on stale, pull and replace local. Throws
 * SyncQuotaExceededError if the user is over their daily budget. Throws
 * any other transport error too — caller should surface to the UI.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (!isSyncConfigured()) {
    throw new Error("sync transport not configured (not signed in?)")
  }
  try {
    await pushNow(getState().snapshot)
    return { kind: "pushed", quota: null }
  } catch (e) {
    if (e instanceof StaleSnapshotError) {
      await pullAndReplace()
      return { kind: "pulled-on-stale" }
    }
    if (e instanceof SyncQuotaExceededError) throw e
    throw e
  }
}

/**
 * Pull and replace local snapshot. Bypasses the 3/day push budget.
 * Returns true if a remote snapshot existed and was applied.
 */
export async function pullAndReplace(): Promise<boolean> {
  if (!isSyncConfigured()) return false
  const result = await _internalPullBytes()
  if (!result) return false
  await replaceSnapshotFromBytes(result.bytes)
  return true
}

/**
 * Pull the remote snapshot and parse it for preview metadata. Returns null
 * if the user has never pushed. The raw bytes are returned alongside the
 * counts so applyRemoteBytes() can replace local without a second fetch.
 */
export async function previewRemote(): Promise<RemotePreview | null> {
  if (!isSyncConfigured()) {
    throw new Error("sync transport not configured (not signed in?)")
  }
  const result = await _internalPullBytes()
  if (!result) return null
  const { snapshot } = await parse(result.bytes)
  return {
    exportedAt: snapshot.exported_at ?? null,
    workoutCount: snapshot.workouts.length,
    setCount: snapshot.sets.length,
    customExerciseCount: snapshot.exercises.filter((e) => e.is_custom).length,
    gymCount: snapshot.gyms.length,
    bytes: result.bytes,
  }
}

/** Replace local snapshot with bytes already pulled (typically from previewRemote). */
export async function applyRemoteBytes(bytes: Uint8Array): Promise<void> {
  await replaceSnapshotFromBytes(bytes)
}

/** Fetch current daily push quota from the server. Bypasses the budget. */
export async function fetchQuota(): Promise<Quota | null> {
  const t = getTransport()
  if (!(t instanceof CloudflareTransport)) return null
  return t.getQuota()
}

/** Last quota seen by push or fetchQuota. Synchronous; for UI badges. */
export function getCachedQuota(): Quota | null {
  const t = getTransport()
  if (!(t instanceof CloudflareTransport)) return null
  return t.getCachedQuota()
}
