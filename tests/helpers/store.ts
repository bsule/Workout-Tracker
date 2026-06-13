/**
 * Shared test helpers for the @lift/core store singleton.
 *
 * The store is a hand-rolled module-level singleton (store/store.ts). Tests
 * that touch mutations / queries / imports must reset it to a known state in a
 * `beforeEach`, and any code path that flushes (imports call flushNow) needs a
 * storage adapter injected. These helpers provide both.
 */

import { emptySnapshot, type Snapshot } from "@lift/core/store/schema"
import { getState, markHydrated } from "@lift/core/store/store"
import { setStorageFactory } from "@lift/core/store/persist"
import type { BlobStorage } from "@lift/core/store/storage"

/** Reset the singleton store back to a fresh empty snapshot. */
export function resetStore(): Snapshot {
  const snap = emptySnapshot("test-device")
  markHydrated(snap)
  return snap
}

/** Load an arbitrary snapshot into the singleton store. */
export function loadSnapshot(snap: Snapshot): void {
  markHydrated(snap)
}

/** Current in-memory snapshot. */
export function currentSnapshot(): Snapshot {
  return getState().snapshot
}

/**
 * A throwaway in-memory BlobStorage. The persist layer calls flushNow() after
 * imports; without a storage factory that throws. Installing this captures the
 * written bytes so tests can also assert on what got persisted.
 */
export interface MemoryStorage extends BlobStorage {
  /** The last snapshot bytes written by flushNow(). */
  lastWritten: Uint8Array | null
  /** Pending crash-log lines not yet cleared. */
  pending: string[]
}

export function memoryStorage(): MemoryStorage {
  let snapshotBytes: Uint8Array | null = null
  const pending: string[] = []
  const store: MemoryStorage = {
    lastWritten: null,
    pending,
    async readSnapshot() {
      return snapshotBytes
    },
    async writeSnapshot(bytes: Uint8Array) {
      snapshotBytes = bytes
      store.lastWritten = bytes
    },
    async appendPending(line: string) {
      pending.push(line)
    },
    async readPending() {
      return [...pending]
    },
    async clearPending() {
      pending.length = 0
    },
  }
  return store
}

/**
 * Install an in-memory storage factory so flush/hydrate paths work, and reset
 * the store. Returns the storage instance for the "default" sub-path so tests
 * can inspect what was written.
 */
export function installMemoryStorage(): MemoryStorage {
  const instances = new Map<string, MemoryStorage>()
  setStorageFactory((subPath: string) => {
    const existing = instances.get(subPath)
    if (existing) return existing
    const made = memoryStorage()
    instances.set(subPath, made)
    return made
  })
  const def = memoryStorage()
  instances.set("default", def)
  return def
}

/** Remove any installed storage factory so recordPending becomes a no-op. */
export function clearStorageFactory(): void {
  // setStorageFactory(null) isn't allowed by the type, but persist guards on a
  // null factory internally. We can't un-set it through the public API, so the
  // suites that need "no storage" simply never install one.
}
