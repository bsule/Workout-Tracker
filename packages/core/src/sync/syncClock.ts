/**
 * "Last synced" clock — the timestamp of the last time this device and the
 * cloud held the same data.
 *
 * It is deliberately NOT part of the Snapshot. serialize() re-stamps
 * exported_at on every push (store/blob.ts), so a timestamp stored inside the
 * snapshot would dirty the snapshot on every push and never settle. It is also
 * a fact about one device, not about the account: two devices keep two clocks.
 *
 * The core can't reach localStorage / AsyncStorage, so hosts inject a store the
 * same way they inject BlobStorage — see configureSyncClock(). Until a host
 * injects one, every read is null and every write is a no-op.
 *
 * Lifecycle mirrors the transport etag: configure on boot/login, clear on
 * login/signup/logout. Every sync path that makes local and cloud match calls
 * markSynced(), so a manual "Sync now" and the background check in
 * autoSync.maybeAutoSync() share one value.
 */

export interface SyncClockStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

let store: SyncClockStore | null = null
let cached: number | null = null
let loaded = false
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

/**
 * Install (or remove) the host's storage. Resets the in-memory value, so the
 * next loadSyncClock() re-reads. Call this before the first sync of a session.
 */
export function configureSyncClock(s: SyncClockStore | null): void {
  store = s
  cached = null
  loaded = false
  emit()
}

/**
 * Read the clock from storage once per session, then answer from memory.
 * Returns null when this device has never synced. Never throws: unreadable
 * storage reads as "never synced".
 */
export async function loadSyncClock(): Promise<number | null> {
  if (loaded) return cached
  const s = store
  if (!s) return null
  let value: number | null = null
  try {
    const raw = await s.get()
    const n = raw === null ? NaN : Number(raw)
    value = Number.isFinite(n) && n > 0 ? n : null
  } catch {
    value = null
  }
  // The user switched account while the read was in flight — drop the result.
  if (store !== s) return cached
  cached = value
  loaded = true
  emit()
  return cached
}

/** Synchronous read for render. Null until loadSyncClock() has run. */
export function getLastSyncedAt(): number | null {
  return cached
}

/**
 * Record a successful sync. Synchronous by design: the disk write is
 * fire-and-forget so a failed write can never turn a good sync into a
 * failed one.
 */
export function markSynced(at: number = Date.now()): void {
  cached = at
  loaded = true
  store?.set(String(at)).catch(() => {})
  emit()
}

/** Forget the clock. Call wherever the transport etag is cleared. */
export function clearSyncClock(): void {
  cached = null
  loaded = true
  store?.clear().catch(() => {})
  emit()
}

/** Subscribe to clock changes so a "last synced" label can re-render. */
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
