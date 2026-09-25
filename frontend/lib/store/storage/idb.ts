import type { BlobStorage } from "@lift/core/store/storage"

const DB_NAME = "lift-store"
const DB_VERSION = 1
const STORE = "kv"

const SNAPSHOT_KEY_PREFIX = "snapshot:"
const PENDING_KEY_PREFIX = "pending:"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const store = t.objectStore(STORE)
        const result = fn(store)
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result)
          result.onerror = () => reject(result.error)
        } else {
          result.then(resolve, reject)
        }
        t.onerror = () => reject(t.error)
      })
  )
}

/**
 * IndexedDB-backed storage. Per-instance write queue serializes
 * `appendPending` / `writeSnapshot` / `clearPending` so concurrent callers
 * don't lose entries to read-modify-write races. A failed write doesn't
 * poison the queue.
 */
export class IdbStorage implements BlobStorage {
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly subPath: string) {}

  private snapshotKey() {
    return SNAPSHOT_KEY_PREFIX + this.subPath
  }
  private pendingKey() {
    return PENDING_KEY_PREFIX + this.subPath
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => fn())
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  async readSnapshot(): Promise<Uint8Array | null> {
    const value = await tx<unknown>("readonly", (s) => s.get(this.snapshotKey()))
    if (!value) return null
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    return null
  }

  async writeSnapshot(bytes: Uint8Array): Promise<void> {
    await this.enqueue(() =>
      tx<IDBValidKey>("readwrite", (s) => s.put(bytes, this.snapshotKey()))
    )
  }

  async appendPending(line: string): Promise<void> {
    await this.enqueue(async () => {
      const existing =
        (await tx<string | undefined>("readonly", (s) =>
          s.get(this.pendingKey())
        )) ?? ""
      await tx<IDBValidKey>("readwrite", (s) =>
        s.put(existing + line + "\n", this.pendingKey())
      )
    })
  }

  // Enqueued: hydrate() reads, replays, then clears. An append landing between
  // an unqueued read and the queued clearPending is lost.
  async readPending(): Promise<string[]> {
    return this.enqueue(async () => {
      const text = await tx<string | undefined>("readonly", (s) =>
        s.get(this.pendingKey())
      )
      if (!text) return []
      return text.split("\n").filter((l) => l.length > 0)
    })
  }

  async clearPending(): Promise<void> {
    await this.enqueue(() =>
      tx<undefined>("readwrite", (s) => s.delete(this.pendingKey()))
    )
  }
}

/**
 * Moves an IndexedDB store from `fromSubPath` to `toSubPath` (see
 * adoptLegacyWebStore): both keys in one transaction, so it either happens
 * whole or not at all. Only when the new store has nothing yet.
 */
export async function adoptLegacyIdbStore(
  fromSubPath: string,
  toSubPath: string
): Promise<boolean> {
  const db = await open()
  return new Promise<boolean>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite")
    const store = t.objectStore(STORE)
    const keys = {
      fromSnap: SNAPSHOT_KEY_PREFIX + fromSubPath,
      fromPending: PENDING_KEY_PREFIX + fromSubPath,
      toSnap: SNAPSHOT_KEY_PREFIX + toSubPath,
      toPending: PENDING_KEY_PREFIX + toSubPath,
    }
    const values: Record<string, unknown> = {}
    let moved = false
    const names = Object.keys(keys) as (keyof typeof keys)[]
    let left = names.length
    for (const name of names) {
      const req = store.get(keys[name])
      req.onsuccess = () => {
        values[name] = req.result
        if (--left > 0) return
        if (values.toSnap != null || values.toPending != null) return
        if (values.fromSnap == null && values.fromPending == null) return
        if (values.fromSnap != null) store.put(values.fromSnap, keys.toSnap)
        if (values.fromPending != null) store.put(values.fromPending, keys.toPending)
        store.delete(keys.fromSnap)
        store.delete(keys.fromPending)
        moved = true
      }
    }
    t.oncomplete = () => resolve(moved)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
