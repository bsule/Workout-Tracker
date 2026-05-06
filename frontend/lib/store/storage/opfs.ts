import type { BlobStorage } from "./types"

const SNAPSHOT_NAME = "snapshot.json.gz"
const PENDING_NAME = "pending.log"

export function isOpfsAvailable(): boolean {
  if (typeof navigator === "undefined") return false
  return Boolean(
    typeof navigator.storage?.getDirectory === "function" &&
      typeof FileSystemFileHandle !== "undefined"
  )
}

/**
 * OPFS-backed storage.
 *
 * **Why we re-resolve the directory handle on every operation.** A previous
 * version cached `Promise<FileSystemDirectoryHandle>` for the lifetime of the
 * instance. That handle could be silently invalidated by Turbopack hot
 * reloads, browser GC, or the user clearing site data; subsequent calls
 * 404'd with NotFoundError and writes silently dropped. Re-resolving via
 * `navigator.storage.getDirectory()` + walking the sub-path on each call is
 * sub-millisecond (browsers internally cache the root handle) and eliminates
 * the entire stale-handle bug class. Hot reload can't invalidate a handle
 * that doesn't outlive a single operation.
 *
 * **Concurrent writes.** `appendPending` is read-modify-write — concurrent
 * callers used to race and lose entries. Writes now serialize through a
 * per-instance promise queue. Failed writes don't poison the queue.
 */
export class OpfsStorage implements BlobStorage {
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly subPath: string) {}

  /** Always resolves a fresh handle. Don't cache this. */
  private async dir(): Promise<FileSystemDirectoryHandle> {
    let handle = await navigator.storage.getDirectory()
    for (const part of this.subPath.split("/").filter(Boolean)) {
      handle = await handle.getDirectoryHandle(part, { create: true })
    }
    return handle
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => fn())
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  async readSnapshot(): Promise<Uint8Array | null> {
    try {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(SNAPSHOT_NAME, { create: false })
      const file = await fh.getFile()
      if (file.size === 0) return null
      const buf = await file.arrayBuffer()
      return new Uint8Array(buf)
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  async writeSnapshot(bytes: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(SNAPSHOT_NAME, { create: true })
      const writable = await fh.createWritable()
      await writable.write(new Blob([new Uint8Array(bytes)]))
      await writable.close()
    })
  }

  async appendPending(line: string): Promise<void> {
    return this.enqueue(async () => {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(PENDING_NAME, { create: true })
      const file = await fh.getFile()
      const existing = file.size ? await file.text() : ""
      const writable = await fh.createWritable()
      await writable.write(existing + line + "\n")
      await writable.close()
    })
  }

  async readPending(): Promise<string[]> {
    try {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(PENDING_NAME, { create: false })
      const file = await fh.getFile()
      if (file.size === 0) return []
      const text = await file.text()
      return text.split("\n").filter((l) => l.length > 0)
    } catch (e) {
      if (isNotFound(e)) return []
      throw e
    }
  }

  async clearPending(): Promise<void> {
    return this.enqueue(async () => {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(PENDING_NAME, { create: true })
      const writable = await fh.createWritable()
      await writable.write(new Uint8Array(0))
      await writable.close()
    })
  }
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "NotFoundError" || e.name === "NotFound")
  )
}
