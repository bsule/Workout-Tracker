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
  private readonly pendingPath: string

  constructor(subPath: string) {
    this.dir = dirFor(subPath)
    this.snapshotPath = this.dir + "snapshot.bin"
    this.pendingPath = this.dir + "pending.log"
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => fn())
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  async readSnapshot(): Promise<Uint8Array | null> {
    const info = await FileSystem.getInfoAsync(this.snapshotPath)
    if (!info.exists) return null
    const b64 = await FileSystem.readAsStringAsync(this.snapshotPath, {
      encoding: FileSystem.EncodingType.Base64,
    })
    if (!b64) return null
    return base64ToBytes(b64)
  }

  async writeSnapshot(bytes: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      await ensureDir(this.dir)
      await FileSystem.writeAsStringAsync(
        this.snapshotPath,
        bytesToBase64(bytes),
        { encoding: FileSystem.EncodingType.Base64 }
      )
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

  async readPending(): Promise<string[]> {
    const info = await FileSystem.getInfoAsync(this.pendingPath)
    if (!info.exists) return []
    const text = await FileSystem.readAsStringAsync(this.pendingPath)
    return text.split("\n").filter((l) => l.length > 0)
  }

  async clearPending(): Promise<void> {
    await this.enqueue(async () => {
      const info = await FileSystem.getInfoAsync(this.pendingPath)
      if (info.exists) await FileSystem.deleteAsync(this.pendingPath, { idempotent: true })
    })
  }
}
