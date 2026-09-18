/**
 * Device-local sync state: when this device and the cloud last agreed, and
 * whether a push was refused because the cloud moved ahead.
 *
 * It is deliberately NOT part of the Snapshot. serialize() re-stamps
 * exported_at on every push (store/blob.ts), so a timestamp stored inside the
 * snapshot would dirty the snapshot on every push and never settle. It is also
 * a fact about one device, not about the account: two devices keep two clocks.
 *
 * The core can't reach localStorage / AsyncStorage, so hosts inject a store the
 * same way they inject BlobStorage — see configureSyncClock(). Until a host
 * injects one, every read is empty and every write is a no-op.
 *
 * Lifecycle mirrors the transport etag: configure on boot/login, clear on
 * login/signup/logout. Every sync path that makes local and cloud agree calls
 * markSynced(), so a manual "Sync now" and the background check in
 * autoSync.maybeAutoSync() share one value.
 */

export interface SyncClockStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

export interface SyncClockSnapshot {
  /** When local and cloud last agreed. Null means never synced here. */
  lastSyncedAt: number | null
  /** When a push was last refused because the cloud is ahead. */
  cloudNewerAt: number | null
  /** Which cloud version is ahead. The server's etag, an opaque cookie. */
  cloudNewerEtag: string | null
  /**
   * The cloud version the user has already been told about. Equal to
   * cloudNewerEtag once the prompt has been shown, so the app asks once per
   * distinct cloud version and never nags about the same one twice.
   */
  promptedForEtag: string | null
}

/**
 * Stands in for "the server did not report an etag" inside promptedForEtag.
 * Without it, a conflict with no etag could never be marked as told, and the
 * prompt would reopen on every app start — the exact nagging this avoids.
 * A real etag is never the empty string.
 */
const NO_ETAG = ""

const EMPTY: SyncClockSnapshot = {
  lastSyncedAt: null,
  cloudNewerAt: null,
  cloudNewerEtag: null,
  promptedForEtag: null,
}

let store: SyncClockStore | null = null
let cached: SyncClockSnapshot = EMPTY
let loaded = false
/**
 * A one-shot request to open the prompt even though the user has already been
 * told about this cloud version. Pressing "Sync now" must always answer, and
 * the "ask once" rule is about unprompted interruptions, not about ignoring a
 * button press. In memory only: a request does not outlive the session.
 */
let forcePrompt = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // A bad subscriber must not break the sync that notified it.
    }
  }
}

function commit(next: SyncClockSnapshot): void {
  cached = next
  loaded = true
  store?.set(JSON.stringify(next)).catch(() => {})
  emit()
}

/**
 * Install (or remove) the host's storage. Resets the in-memory value, so the
 * next loadSyncClock() re-reads. Call this before the first sync of a session.
 */
export function configureSyncClock(s: SyncClockStore | null): void {
  store = s
  cached = EMPTY
  loaded = false
  forcePrompt = false
  emit()
}

/**
 * Parse a stored payload. Accepts the record written today and the bare
 * timestamp written by the first version of this module, so an install that
 * predates the conflict fields keeps its clock.
 */
function parseStored(raw: string | null): SyncClockSnapshot {
  if (raw === null) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? { ...EMPTY, lastSyncedAt: value }
      : EMPTY
  }
  if (typeof value !== "object" || value === null) return EMPTY
  const o = value as Partial<SyncClockSnapshot>
  return {
    lastSyncedAt: positiveOrNull(o.lastSyncedAt),
    cloudNewerAt: positiveOrNull(o.cloudNewerAt),
    cloudNewerEtag: typeof o.cloudNewerEtag === "string" ? o.cloudNewerEtag : null,
    promptedForEtag:
      typeof o.promptedForEtag === "string" ? o.promptedForEtag : null,
  }
}

function positiveOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Read from storage once per session, then answer from memory. Never throws:
 * unreadable storage reads as "never synced".
 */
export async function loadSyncClock(): Promise<SyncClockSnapshot> {
  if (loaded) return cached
  const s = store
  if (!s) return cached
  let next: SyncClockSnapshot
  try {
    next = parseStored(await s.get())
  } catch {
    next = EMPTY
  }
  // The user switched account while the read was in flight — drop the result.
  if (store !== s) return cached
  cached = next
  loaded = true
  emit()
  return cached
}

/** Synchronous read for render. Empty until loadSyncClock() has run. */
export function getSyncClock(): SyncClockSnapshot {
  return cached
}

/** Convenience for the "last synced" label. */
export function getLastSyncedAt(): number | null {
  return cached.lastSyncedAt
}

/**
 * Record a successful sync. Clears any recorded conflict: local and cloud
 * agree again. Synchronous by design — the disk write is fire-and-forget so a
 * failed write can never turn a good sync into a failed one.
 */
export function markSynced(at: number = Date.now()): void {
  forcePrompt = false
  commit({ ...EMPTY, lastSyncedAt: at })
}

/**
 * Record that the server refused a push because the cloud is ahead. Keeps the
 * last-synced timestamp: it is still true, and it is what the user needs to
 * judge how far behind this device is.
 *
 * Re-recording the same etag leaves promptedForEtag alone, so a repeat refusal
 * does not re-open a prompt the user already dismissed.
 */
export function markCloudNewer(
  remoteEtag: string | null,
  at: number = Date.now()
): void {
  commit({
    ...cached,
    cloudNewerAt: at,
    cloudNewerEtag: remoteEtag,
  })
}

/**
 * Remember that the user has been told about the current cloud version. Call
 * this when the prompt opens, not when it is answered: dismissing it, ignoring
 * it, or force-quitting the app all count as told.
 */
export function markCloudNewerPrompted(): void {
  if (cached.cloudNewerAt === null) return
  forcePrompt = false
  commit({ ...cached, promptedForEtag: cached.cloudNewerEtag ?? NO_ETAG })
}

/**
 * Open the prompt once more, even if the user has already seen it for this
 * cloud version. For an explicit "Sync now" that the server refuses: the press
 * deserves an answer. No-op when there is no conflict to show.
 */
export function requestCloudNewerPrompt(): void {
  if (cached.cloudNewerAt === null) return
  forcePrompt = true
  emit()
}

/** True while a push is known to be refused. Drives the passive marker. */
export function hasCloudConflict(): boolean {
  return cached.cloudNewerAt !== null
}

/**
 * True when the user should be interrupted. False once they have been told
 * about this cloud version — it turns true again only if the cloud changes
 * again, which is new information rather than a repeat.
 *
 * A server that does not report an etag collapses to one prompt per conflict:
 * every refusal then looks like the same cloud version.
 */
export function shouldPromptCloudNewer(): boolean {
  if (cached.cloudNewerAt === null) return false
  if (forcePrompt) return true
  return cached.promptedForEtag !== (cached.cloudNewerEtag ?? NO_ETAG)
}

/** Forget everything. Call wherever the transport etag is cleared. */
export function clearSyncClock(): void {
  cached = EMPTY
  loaded = true
  forcePrompt = false
  store?.clear().catch(() => {})
  emit()
}

/** Subscribe to changes so a label or a prompt can react. */
export function subscribeSyncClock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Shared label text for both clients. */
export function formatLastSynced(
  at: number | null,
  now: number = Date.now()
): string {
  if (at === null) return "Never synced"
  const diff = Math.max(0, now - at)
  if (diff < 60_000) return "Synced just now"
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `Synced ${minutes} minute${plural(minutes)} ago`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `Synced ${hours} hour${plural(hours)} ago`
  const days = Math.floor(diff / 86_400_000)
  return `Last synced ${days} day${plural(days)} ago`
}

function plural(n: number): string {
  return n === 1 ? "" : "s"
}
