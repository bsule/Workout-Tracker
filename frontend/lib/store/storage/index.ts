import type { BlobStorage } from "@lift/core/store/storage"
import { adoptLegacyIdbStore, IdbStorage } from "./idb"
import { adoptLegacyOpfsStore, isOpfsAvailable, OpfsStorage } from "./opfs"

export type { BlobStorage } from "@lift/core/store/storage"

// OPFS where supported, IDB fallback. Both adapters re-resolve their handles
// per operation and serialize writes, so neither suffers from stale-handle
// or read-modify-write race classes of bugs.
export function pickWebStorage(subPath: string): BlobStorage {
  if (typeof window === "undefined") {
    return new MemoryStorage()
  }
  if (isOpfsAvailable()) {
    return new OpfsStorage(subPath)
  }
  return new IdbStorage(subPath)
}

/**
 * Moves a store kept under `fromSubPath` to `toSubPath`, in whichever backend
 * pickWebStorage() uses, when the new one is still empty and the old one has
 * data. Runs before configure(), once per account: the old path is gone
 * afterwards. Returns whether it moved anything.
 */
export async function adoptLegacyWebStore(
  fromSubPath: string,
  toSubPath: string
): Promise<boolean> {
  if (typeof window === "undefined" || fromSubPath === toSubPath) return false
  if (isOpfsAvailable()) return adoptLegacyOpfsStore(fromSubPath, toSubPath)
  return adoptLegacyIdbStore(fromSubPath, toSubPath)
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
