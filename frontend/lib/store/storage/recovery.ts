import type { BlobStorage, SnapshotStats } from "@lift/core/store/storage"
import { parse } from "@lift/core/store/blob"
import { snapshotStats } from "@lift/core/store/persist"

export type RestoreSlot = "previous" | "daily" | "undo"
export interface RestorePoint {
  bytes: Uint8Array
  stats: SnapshotStats
}
interface RecoveryData {
  current?: SnapshotStats
  previous?: RestorePoint
  daily?: RestorePoint
  undo?: RestorePoint
}

const listeners = new Set<() => void>()
export function subscribeRestorePoints(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** One record per account; commit completion (not request success) is durability. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lift-recovery", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("accounts")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function access<T>(path: string, update: ((data: RecoveryData) => RecoveryData) | null,
  select: (data: RecoveryData) => T): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("accounts", update ? "readwrite" : "readonly")
    const store = tx.objectStore("accounts")
    const request = store.get(path)
    let result: T
    request.onsuccess = () => {
      const data: RecoveryData = request.result ?? {}
      result = select(data)
      if (update) store.put(update(data), path)
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
      if (update) for (const listener of listeners) {
        try { listener() }
        catch (error) { console.error("Restore-point listener failed", error) }
      }
    }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Could not save a restore point.")) }
  })
}

/** Wraps either OPFS or IDB; recovery records always use transactional IDB.
 * The editor's lifetime Web Lock covers both stores. Copies are committed
 * before changing the main snapshot, including before destructive replaces. */
export class RecoveryStorage implements BlobStorage {
  private queue: Promise<unknown> = Promise.resolve()
  private skipRotation = false
  private holdingDaily = false
  private preserveUndo = false

  constructor(private readonly path: string, private readonly base: BlobStorage) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  readSnapshot() { return this.base.readSnapshot() }
  appendPending(line: string) { return this.enqueue(() => this.base.appendPending(line)) }
  readPending() { return this.enqueue(() => this.base.readPending()) }
  clearPending() { return this.enqueue(() => this.base.clearPending()) }

  list(): Promise<Partial<Record<RestoreSlot, SnapshotStats>>> {
    return this.enqueue(() => access(this.path, null, (data) => ({
      previous: data.previous?.stats, daily: data.daily?.stats, undo: data.undo?.stats,
    })))
  }

  readSlot(slot: RestoreSlot): Promise<Uint8Array | null> {
    return this.enqueue(() => access(this.path, null, (data) => data[slot]?.bytes ?? null))
  }

  saveUndo(bytes: Uint8Array, stats: SnapshotStats): Promise<void> {
    return this.enqueue(() => access(this.path, (data) => ({ ...data, undo: { bytes, stats } }), () => undefined))
  }

  beforeReplace(bytes: Uint8Array, stats: SnapshotStats): Promise<void> {
    return this.preserveUndo ? Promise.resolve() : this.saveUndo(bytes, stats)
  }

  async restoring<T>(fn: () => Promise<T>, preserveUndo = false): Promise<T> {
    this.holdingDaily = true
    this.preserveUndo = preserveUndo
    try { return await fn() }
    finally { this.holdingDaily = false; this.preserveUndo = false }
  }

  snapshotCandidates() {
    return [() => this.readSnapshot(), ...(["previous", "daily", "undo"] as const).map((slot) => () => this.readSlot(slot))]
  }

  async discardSnapshotCopies(indexes: number[]) {
    if (indexes.includes(0)) this.skipRotation = true
    const slots = ["previous", "daily", "undo"] as const
    await this.enqueue(() => access(this.path, (data) => {
      const next = { ...data }
      for (const index of indexes) if (index > 0) delete next[slots[index - 1]]
      return next
    }, () => undefined))
  }

  writeSnapshot(bytes: Uint8Array, stats?: SnapshotStats): Promise<void> {
    return this.enqueue(async () => {
      const old = this.skipRotation ? null : await this.base.readSnapshot()
      const metadata = await access(this.path, null, (data) => data.current)
      // Validate a legacy/current copy before it enters recovery history.
      // Once written through this adapter, its trusted metadata avoids decoding.
      let oldStats = metadata
      if (old && !oldStats) {
        try { oldStats = snapshotStats((await parse(old)).snapshot) }
        catch { /* A damaged legacy file must not replace a good restore point. */ }
      }
      const currentStats = stats ?? snapshotStats((await parse(bytes)).snapshot)
      const holdingDaily = this.holdingDaily
      await access(this.path, (data) => {
        const next = { ...data }
        if (old && oldStats) {
          const previous = { bytes: old, stats: oldStats }
          next.previous = previous
          if (!holdingDaily && (!data.daily || Date.now() - Date.parse(data.daily.stats.savedAt) >= 86_400_000)) {
            next.daily = previous
          }
        }
        return next
      }, () => undefined)
      await this.base.writeSnapshot(bytes, stats)
      await access(this.path, (data) => ({ ...data, current: currentStats }), () => undefined)
      this.skipRotation = false
    })
  }
}
