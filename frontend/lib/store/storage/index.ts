import { IdbStorage } from "./idb"
import { isOpfsAvailable, OpfsStorage } from "./opfs"
import type { BlobStorage } from "./types"

export type { BlobStorage } from "./types"

// OPFS where supported, IDB fallback. Both adapters re-resolve their handles
// per operation and serialize writes, so neither suffers from stale-handle
// or read-modify-write race classes of bugs.
export function pickStorage(subPath: string): BlobStorage {
  if (typeof window === "undefined") {
    return new MemoryStorage()
  }
  if (isOpfsAvailable()) {
    return new OpfsStorage(subPath)
  }
  return new IdbStorage(subPath)
}

class MemoryStorage implements BlobStorage {
  private snap: Uint8Array | null = null
  private pending: string[] = []
  async readSnapshot() {
    return this.snap
  }
  async writeSnapshot(bytes: Uint8Array) {
    this.snap = bytes
  }
  async appendPending(line: string) {
    this.pending.push(line)
  }
  async readPending() {
    return [...this.pending]
  }
  async clearPending() {
    this.pending = []
  }
}
