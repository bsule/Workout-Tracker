// expo-file-system v19 split the API: the free-function helpers we use
// (documentDirectory, getInfoAsync, read/writeAsStringAsync, EncodingType)
// live under "expo-file-system/legacy". The new class-based `File`/`Directory`
// API isn't worth migrating to right now — it's the same persistence model.
import * as FileSystem from "expo-file-system/legacy"
import type { BlobStorage } from "@lift/core/store/storage"

const ROOT = FileSystem.documentDirectory + "lift/"

function dirFor(subPath: string) {
  // subPath may contain "/" — translate to a single safe segment.
  const safe = subPath.replace(/[^a-zA-Z0-9_-]/g, "_")
  return ROOT + safe + "/"
}

async function ensureDir(path: string) {
  const info = await FileSystem.getInfoAsync(path)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true })
  }
}

// Browser btoa/atob exist in RN for ASCII strings; for binary we go through
// base64 on the file boundary.
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    )
  }
  return (globalThis as { btoa(s: string): string }).btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = (globalThis as { atob(s: string): string }).atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * BlobStorage backed by expo-file-system. Mirrors the IDB adapter's behavior:
 * a per-instance write queue serializes appendPending/writeSnapshot/clearPending
 * so concurrent callers can't lose entries to read-modify-write races.
 */
export class RnFsStorage implements BlobStorage {
  private writeQueue: Promise<unknown> = Promise.resolve()
  private readonly dir: string
  private readonly snapshotPath: string
  private readonly snapshotTmpPath: string
  private readonly snapshotBakPath: string
  private readonly pendingPath: string

  constructor(subPath: string) {
    this.dir = dirFor(subPath)
    this.snapshotPath = this.dir + "snapshot.bin"
    this.snapshotTmpPath = this.dir + "snapshot.bin.tmp"
    this.snapshotBakPath = this.dir + "snapshot.bin.bak"
    this.pendingPath = this.dir + "pending.log"
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => fn())
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  async readSnapshot(): Promise<Uint8Array | null> {
    // Live snapshot, then .bak. Returning the backup beats returning null:
    // hydrate() treats an unreadable snapshot as "start fresh", losing history.
    for (const path of [this.snapshotPath, this.snapshotBakPath]) {
      const info = await FileSystem.getInfoAsync(path)
      if (!info.exists) continue
      try {
        const b64 = await FileSystem.readAsStringAsync(path, {
          encoding: FileSystem.EncodingType.Base64,
        })
        if (!b64) continue
        return base64ToBytes(b64)
      } catch (e) {
        console.error(`Failed to read snapshot at ${path}`, e)
      }
    }
    return null
  }

  // Atomic: fill tmp, rotate current to .bak, move tmp into place — a kill
  // never leaves a torn file, which flushNow() would then clear the log after.
  async writeSnapshot(bytes: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      await ensureDir(this.dir)
      await FileSystem.writeAsStringAsync(
        this.snapshotTmpPath,
        bytesToBase64(bytes),
        { encoding: FileSystem.EncodingType.Base64 }
      )
      const current = await FileSystem.getInfoAsync(this.snapshotPath)
      if (current.exists) {
        await FileSystem.deleteAsync(this.snapshotBakPath, { idempotent: true })
        await FileSystem.moveAsync({
          from: this.snapshotPath,
          to: this.snapshotBakPath,
        })
      }
      await FileSystem.moveAsync({
        from: this.snapshotTmpPath,
        to: this.snapshotPath,
      })
    })
  }

  async appendPending(line: string): Promise<void> {
    await this.enqueue(async () => {
      await ensureDir(this.dir)
      const info = await FileSystem.getInfoAsync(this.pendingPath)
      const existing = info.exists
        ? await FileSystem.readAsStringAsync(this.pendingPath)
        : ""
      await FileSystem.writeAsStringAsync(
        this.pendingPath,
        existing + line + "\n"
      )
    })
  }

  // Enqueued: hydrate() reads, replays, then clears. An append landing between
  // an unqueued read and the queued clearPending is dropped silently.
  async readPending(): Promise<string[]> {
    return this.enqueue(async () => {
      const info = await FileSystem.getInfoAsync(this.pendingPath)
      if (!info.exists) return []
      const text = await FileSystem.readAsStringAsync(this.pendingPath)
      return text.split("\n").filter((l) => l.length > 0)
    })
  }

  async clearPending(): Promise<void> {
    await this.enqueue(async () => {
      const info = await FileSystem.getInfoAsync(this.pendingPath)
      if (info.exists) await FileSystem.deleteAsync(this.pendingPath, { idempotent: true })
    })
  }
}
