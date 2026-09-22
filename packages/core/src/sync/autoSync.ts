/**
 * Manual sync orchestration. The app is local-first by default; the user
 * triggers a round-trip from a Settings button. Server enforces a daily
 * push budget (5/day at the time of writing).
 *
 * Flow on click:
 *   1. Push the in-memory snapshot. ETag/If-Match from the transport.
 *   2. On 200 → done.
 *   3. On 412 (stale) → return { kind: "stale" } so the UI can ask the
 *      user whether to pull cloud (pullAndReplace) or overwrite cloud
 *      (forcePush).
 *   4. On 429 (over quota) → throw SyncQuotaExceededError so UI can show
 *      "X uses today, resets at Y".
 *
 * Pulls (and quota fetches) are unrestricted, so reading remaining quota
 * for the UI is free.
 *
 * Every path here that leaves local and cloud in agreement calls
 * markSynced() (see syncClock.ts). That single clock drives the "last synced"
 * label and the daily check in maybeAutoSync(), so a manual "Sync now"
 * resets the auto-sync timer with no extra wiring.
 */

import { parse } from "../store/blob"
import { replaceSnapshotFromBytes } from "../store/persist"
import { getState } from "../store/store"
import {
  getSyncClock,
  hasCloudConflict,
  loadSyncClock,
  markCloudNewer,
  markSynced,
} from "./syncClock"
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
  | { kind: "stale"; remoteEtag: string | null }

export interface RemotePreview {
  exportedAt: string | null
  workoutCount: number
  setCount: number
  customExerciseCount: number
  gymCount: number
  bytes: Uint8Array
}

/**
 * Run a full sync. Push first; on stale, return { kind: "stale" } so the
 * caller can prompt the user (pull cloud vs. overwrite cloud). Throws
 * SyncQuotaExceededError if the user is over their daily budget. Throws
 * any other transport error too — caller should surface to the UI.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (!isSyncConfigured()) {
    throw new Error("sync transport not configured (not signed in?)")
  }
  try {
    await pushNow(getState().snapshot)
    markSynced()
    return { kind: "pushed", quota: null }
  } catch (e) {
    if (e instanceof StaleSnapshotError) {
      // Nothing was overwritten: the server refused the push on its If-Match
      // precondition. Record which cloud version won so the host can tell the
      // user once — the manual button and the automatic check share this.
      markCloudNewer(e.remoteEtag)
      return { kind: "stale", remoteEtag: e.remoteEtag }
    }
    if (e instanceof SyncQuotaExceededError) throw e
    throw e
  }
}

/**
 * Push local snapshot, overwriting whatever is in the cloud. Pulls first
 * to refresh the etag so the server accepts the push, then pushes. Use
 * after syncNow() returns { kind: "stale" } and the user chooses to
 * overwrite cloud.
 */
export async function forcePush(): Promise<void> {
  if (!isSyncConfigured()) {
    throw new Error("sync transport not configured (not signed in?)")
  }
  await _internalPullBytes()
  await pushNow(getState().snapshot)
  markSynced()
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
  markSynced()
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
  markSynced()
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

/** Auto-sync fires when the clock is this old. */
const AUTO_SYNC_PERIOD_MS = 24 * 60 * 60 * 1000
/** After a failed attempt, stay off the network for this long. */
const AUTO_SYNC_RETRY_MS = 6 * 60 * 60 * 1000

let autoInFlight = false
let lastAutoAttemptAt = 0

export type AutoSyncSkip =
  | "in-flight"
  | "not-configured"
  | "not-hydrated"
  | "empty"
  | "never-synced"
  | "not-due"
  | "cooling-down"
  | "cloud-newer"

export type AutoSyncResult =
  | { kind: "skipped"; reason: AutoSyncSkip }
  | { kind: "synced" }
  | { kind: "stale" }
  | { kind: "failed"; error: unknown }

/**
 * Push if this device hasn't synced in a day. Hosts call this on app open
 * (web: after hydrate; mobile: after bootstrap and on AppState "active").
 *
 * Cheap to call often. After the first call of a session the clock is in
 * memory, so the common "not due" answer costs one subtraction — no disk, no
 * network, no render. Offline is not a special case: the push rejects, the
 * clock does not move, the sync stays due, and the cooldown keeps the app off
 * the network for 6 hours. Nothing is shown to the user either way.
 *
 * Never throws.
 */
export async function maybeAutoSync(
  now: number = Date.now()
): Promise<AutoSyncResult> {
  if (autoInFlight) return skipped("in-flight")
  if (!isSyncConfigured()) return skipped("not-configured")

  const state = getState()
  // Pushing before hydrate would upload the empty starting snapshot and
  // overwrite the cloud copy with nothing.
  if (!state.hydrated) return skipped("not-hydrated")
  // Same risk after a wipe or a fresh install that restored nothing. A manual
  // push is the user's decision; an automatic one must not silently erase the
  // cloud copy.
  if (state.snapshot.workouts.length === 0) return skipped("empty")

  await loadSyncClock()
  const clock = getSyncClock()
  // Never synced on this device. The first sync stays a deliberate act.
  if (clock.lastSyncedAt === null) return skipped("never-synced")
  // A refused push stays refused until the user chooses pull or overwrite.
  // Retrying can only fail again, so stay off the network entirely.
  if (hasCloudConflict()) return skipped("cloud-newer")
  if (now - clock.lastSyncedAt < AUTO_SYNC_PERIOD_MS) return skipped("not-due")
  if (lastAutoAttemptAt > 0 && now - lastAutoAttemptAt < AUTO_SYNC_RETRY_MS) {
    return skipped("cooling-down")
  }

  autoInFlight = true
  lastAutoAttemptAt = now
  try {
    // syncNow() calls markSynced() itself on a 200.
    const outcome = await syncNow()
    if (outcome.kind === "pushed") return { kind: "synced" }
    // syncNow() recorded the conflict. Resolving it means choosing between two
    // datasets, so the host asks the user — see shouldPromptCloudNewer().
    return { kind: "stale" }
  } catch (error) {
    // Offline, over quota, or a server error.
    return { kind: "failed", error }
  } finally {
    autoInFlight = false
  }
}

function skipped(reason: AutoSyncSkip): AutoSyncResult {
  return { kind: "skipped", reason }
}

/** Test seam: forget the in-process attempt cooldown. */
export function _resetAutoSyncState(): void {
  autoInFlight = false
  lastAutoAttemptAt = 0
}
