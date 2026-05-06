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

export class OpfsStorage implements BlobStorage {
  private dirPromise: Promise<FileSystemDirectoryHandle> | null = null

  constructor(private readonly subPath: string) {}

  private async dir(): Promise<FileSystemDirectoryHandle> {
    if (!this.dirPromise) {
      this.dirPromise = (async () => {
        let handle = await navigator.storage.getDirectory()
        for (const part of this.subPath.split("/").filter(Boolean)) {
          handle = await handle.getDirectoryHandle(part, { create: true })
        }
        return handle
      })()
    }
    return this.dirPromise
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
    const dir = await this.dir()
    const fh = await dir.getFileHandle(SNAPSHOT_NAME, { create: true })
    const writable = await fh.createWritable()
    await writable.write(new Blob([new Uint8Array(bytes)]))
    await writable.close()
  }

  async appendPending(line: string): Promise<void> {
    const dir = await this.dir()
    const fh = await dir.getFileHandle(PENDING_NAME, { create: true })
    const file = await fh.getFile()
    const existing = file.size ? await file.text() : ""
    const writable = await fh.createWritable()
    await writable.write(existing + line + "\n")
    await writable.close()
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
    try {
      const dir = await this.dir()
      const fh = await dir.getFileHandle(PENDING_NAME, { create: true })
      const writable = await fh.createWritable()
      await writable.write(new Uint8Array(0))
      await writable.close()
    } catch (e) {
      if (isNotFound(e)) return
      throw e
    }
  }
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "NotFoundError" || e.name === "NotFound")
  )
}
