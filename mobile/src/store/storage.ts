// expo-file-system v19 split the API: the free-function helpers we use
// (documentDirectory, getInfoAsync, read/writeAsStringAsync, EncodingType)
// live under "expo-file-system/legacy". The new class-based `File`/`Directory`
// API isn't worth migrating to right now — it's the same persistence model.
import * as FileSystem from "expo-file-system/legacy"
import type { BlobStorage, SnapshotStats } from "@lift/core/store/storage"
import {
  planRotation,
  reconcileMeta,
  type RestoreMeta,
  type Slot,
  type SlotInfo,
} from "./snapshotRotation"

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
  private readonly snapshotBak2Path: string
  private readonly snapshotUndoPath: string
  private readonly metaPath: string
  private readonly pendingPath: string
  // Set while a restore writes its chosen copy, so the write does not also
  // push a fresh file into the daily slot.
  private holdDaily = false

  constructor(subPath: string) {
    this.dir = dirFor(subPath)
    this.snapshotPath = this.dir + "snapshot.bin"
    this.snapshotTmpPath = this.dir + "snapshot.bin.tmp"
    this.snapshotBakPath = this.dir + "snapshot.bin.bak"
    this.snapshotBak2Path = this.dir + "snapshot.bin.bak2"
    this.snapshotUndoPath = this.dir + "snapshot.bin.undo"
    this.metaPath = this.dir + "restore-points.json"
    this.pendingPath = this.dir + "pending.log"
  }

  private pathFor(slot: Slot): string {
    switch (slot) {
      case "current":
        return this.snapshotPath
      case "bak":
        return this.snapshotBakPath
      case "bak2":
        return this.snapshotBak2Path
      case "undo":
        return this.snapshotUndoPath
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => fn())
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  // Live snapshot, then .bak, then .bak2. Returning a backup beats returning
  // null: hydrate() treats no snapshot as "start fresh", losing history.
  async readSnapshot(): Promise<Uint8Array | null> {
    for (const load of this.snapshotCandidates()) {
      try {
        const bytes = await load()
        if (bytes) return bytes
      } catch (e) {
        console.error("Failed to read a snapshot copy", e)
      }
    }
    return null
  }

  // hydrate() walks these itself, so a copy that reads but does not parse
  // also falls back to the next one.
  snapshotCandidates(): Array<() => Promise<Uint8Array | null>> {
    return [this.snapshotPath, this.snapshotBakPath, this.snapshotBak2Path].map(
      (path) => () => this.readPath(path)
    )
  }

  // Same order as snapshotCandidates(). Each damaged copy becomes
  // <name>.corrupt (replacing an older one), out of the rotation but kept.
  async discardSnapshotCopies(indexes: number[]): Promise<void> {
    const paths = [this.snapshotPath, this.snapshotBakPath, this.snapshotBak2Path]
    await this.enqueue(async () => {
      for (const i of indexes) {
        const path = paths[i]
        if (!path) continue
        const info = await FileSystem.getInfoAsync(path)
        if (!info.exists) continue
        await FileSystem.deleteAsync(path + ".corrupt", { idempotent: true })
        await FileSystem.moveAsync({ from: path, to: path + ".corrupt" })
      }
    })
  }

  private async readPath(path: string): Promise<Uint8Array | null> {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return null
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    })
    return b64 ? base64ToBytes(b64) : null
  }

  // Atomic: fill tmp, rotate the older files down, move tmp into place. A kill
  // never leaves a torn file, which flushNow() would then clear the log after.
  // A kill between the moves can leave no snapshot.bin; readSnapshot() then
  // falls back to .bak.
  async writeSnapshot(bytes: Uint8Array, stats?: SnapshotStats): Promise<void> {
    await this.enqueue(async () => {
      await ensureDir(this.dir)
      await FileSystem.writeAsStringAsync(
        this.snapshotTmpPath,
        bytesToBase64(bytes),
        { encoding: FileSystem.EncodingType.Base64 }
      )
      const meta = await this.loadMeta()
      const plan = planRotation(
        meta,
        {
          current: meta.current != null,
          bak: meta.bak != null,
          bak2: meta.bak2 != null,
        },
        stats,
        new Date(),
        { holdDaily: this.holdDaily }
      )
      if (plan.promote) {
        await FileSystem.deleteAsync(this.snapshotBak2Path, { idempotent: true })
        await FileSystem.moveAsync({
          from: this.snapshotBakPath,
          to: this.snapshotBak2Path,
        })
      }
      if (meta.current) {
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
      await this.saveMeta(plan.meta)
    })
  }

  /** One entry per restore point file on disk; see reconcileMeta(). */
  private async loadMeta(): Promise<RestoreMeta> {
    let stored: RestoreMeta = {}
    try {
      const info = await FileSystem.getInfoAsync(this.metaPath)
      if (info.exists) {
        stored = JSON.parse(
          await FileSystem.readAsStringAsync(this.metaPath)
        ) as RestoreMeta
      }
    } catch (e) {
      console.error("Failed to read restore point metadata", e)
    }
    const mtimes: Partial<Record<Slot, number>> = {}
    for (const slot of ["current", "bak", "bak2", "undo"] as const) {
      const info = await FileSystem.getInfoAsync(this.pathFor(slot))
      if (info.exists) mtimes[slot] = info.modificationTime * 1000
    }
    return reconcileMeta(stored, mtimes)
  }

  private async saveMeta(meta: RestoreMeta): Promise<void> {
    await FileSystem.writeAsStringAsync(this.metaPath, JSON.stringify(meta))
  }

  /** What each restore point file holds, for the restore list. */
  async listRestorePoints(): Promise<RestoreMeta> {
    return this.enqueue(() => this.loadMeta())
  }

  async readSlot(slot: Slot): Promise<Uint8Array | null> {
    return this.enqueue(() => this.readPath(this.pathFor(slot)))
  }

  /** Keeps the data a restore is about to replace, so the restore can be undone. */
  async writeUndo(bytes: Uint8Array, stats: SnapshotStats): Promise<void> {
    await this.enqueue(async () => {
      await ensureDir(this.dir)
      await FileSystem.writeAsStringAsync(
        this.snapshotUndoPath,
        bytesToBase64(bytes),
        { encoding: FileSystem.EncodingType.Base64 }
      )
      const meta = await this.loadMeta()
      await this.saveMeta({ ...meta, undo: stats })
    })
  }

  /** Runs `fn` with the daily slot held: its writes rotate .bak but never .bak2. */
  async withDailySlotHeld<T>(fn: () => Promise<T>): Promise<T> {
    this.holdDaily = true
    try {
      return await fn()
    } finally {
      this.holdDaily = false
    }
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

let active: RnFsStorage | null = null

/** The factory passed to setStorageFactory; remembers the signed-in user's adapter. */
export function createActiveStorage(subPath: string): RnFsStorage {
  active = new RnFsStorage(subPath)
  return active
}

export function getActiveStorage(): RnFsStorage | null {
  return active
}

export type { Slot, SlotInfo, RestoreMeta }
