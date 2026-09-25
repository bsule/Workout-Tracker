/**
 * The web half of the account-store move (see accountStore.test.ts for
 * mobile): a store an older build kept under `users/<username>` moves to
 * `accounts/<id>` once, in whichever backend the browser uses.
 *
 * IndexedDB runs on fake-indexeddb. OPFS has no Node implementation, so a
 * small in-memory directory tree stands in for navigator.storage.getDirectory,
 * with only the calls the adapter makes.
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { accountStorePath, legacyStorePath } from "@lift/core/store/paths"
import { IdbStorage, adoptLegacyIdbStore } from "../frontend/lib/store/storage/idb"
import { OpfsStorage, adoptLegacyOpfsStore } from "../frontend/lib/store/storage/opfs"

const bytes = (...n: number[]) => new Uint8Array(n)
const OLD = legacyStorePath("bob")
const NEW = accountStorePath(7)

// ---- a minimal in-memory OPFS ----------------------------------------------

function notFound(): DOMException {
  return new DOMException("not found", "NotFoundError")
}

class FakeFile {
  data: Uint8Array = new Uint8Array(0)
  handle() {
    const file = this
    return {
      async getFile() {
        return new Blob([file.data])
      },
      async createWritable() {
        const parts: BlobPart[] = []
        return {
          async write(chunk: BlobPart) {
            parts.push(chunk)
          },
          async close() {
            file.data = new Uint8Array(await new Blob(parts).arrayBuffer())
          },
        }
      },
    }
  }
}

class FakeDir {
  dirs = new Map<string, FakeDir>()
  files = new Map<string, FakeFile>()
  handle(): FileSystemDirectoryHandle {
    const dir = this
    return {
      async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        let d = dir.dirs.get(name)
        if (!d) {
          if (!opts?.create) throw notFound()
          d = new FakeDir()
          dir.dirs.set(name, d)
        }
        return d.handle()
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        let f = dir.files.get(name)
        if (!f) {
          if (!opts?.create) throw notFound()
          f = new FakeFile()
          dir.files.set(name, f)
        }
        return f.handle()
      },
      async removeEntry(name: string) {
        if (!dir.dirs.delete(name) && !dir.files.delete(name)) throw notFound()
      },
    } as unknown as FileSystemDirectoryHandle
  }
}

let root: FakeDir

function installFakeOpfs() {
  root = new FakeDir()
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory: async () => root.handle() } },
  })
}

// ---- IndexedDB -------------------------------------------------------------

describe("IndexedDB store move", () => {
  beforeEach(() => {
    // A fresh database per test.
    globalThis.indexedDB = new IDBFactory()
  })

  it("moves the snapshot and crash log to the id key and deletes the old keys", async () => {
    const old = new IdbStorage(OLD)
    await old.writeSnapshot(bytes(1, 2, 3))
    await old.appendPending('{"op":"x"}')

    expect(await adoptLegacyIdbStore(OLD, NEW)).toBe(true)

    const moved = new IdbStorage(NEW)
    expect(await moved.readSnapshot()).toEqual(bytes(1, 2, 3))
    expect(await moved.readPending()).toEqual(['{"op":"x"}'])
    expect(await old.readSnapshot()).toBeNull()
    expect(await old.readPending()).toEqual([])
  })

  it("never overwrites an account store that already has data", async () => {
    await new IdbStorage(OLD).writeSnapshot(bytes(1))
    await new IdbStorage(NEW).writeSnapshot(bytes(9))

    expect(await adoptLegacyIdbStore(OLD, NEW)).toBe(false)
    expect(await new IdbStorage(NEW).readSnapshot()).toEqual(bytes(9))
    expect(await new IdbStorage(OLD).readSnapshot()).toEqual(bytes(1))
  })

  it("does nothing when there is no old store", async () => {
    expect(await adoptLegacyIdbStore(OLD, NEW)).toBe(false)
    expect(await new IdbStorage(NEW).readSnapshot()).toBeNull()
  })

  it("moves a crash log with no snapshot yet", async () => {
    await new IdbStorage(OLD).appendPending('{"op":"first"}')
    expect(await adoptLegacyIdbStore(OLD, NEW)).toBe(true)
    expect(await new IdbStorage(NEW).readPending()).toEqual(['{"op":"first"}'])
  })
})

// ---- OPFS ------------------------------------------------------------------

describe("OPFS store move", () => {
  beforeEach(() => {
    installFakeOpfs()
  })

  it("copies the snapshot and crash log to the id path, then deletes the old directory", async () => {
    const old = new OpfsStorage(OLD)
    await old.writeSnapshot(bytes(4, 5, 6))
    await old.appendPending('{"op":"y"}')

    expect(await adoptLegacyOpfsStore(OLD, NEW)).toBe(true)

    const moved = new OpfsStorage(NEW)
    expect(await moved.readSnapshot()).toEqual(bytes(4, 5, 6))
    expect(await moved.readPending()).toEqual(['{"op":"y"}'])
    expect(root.dirs.get("users")?.dirs.has("bob")).toBe(false)
  })

  it("never overwrites an account store that already has a snapshot", async () => {
    await new OpfsStorage(OLD).writeSnapshot(bytes(1))
    await new OpfsStorage(NEW).writeSnapshot(bytes(9))

    expect(await adoptLegacyOpfsStore(OLD, NEW)).toBe(false)
    expect(await new OpfsStorage(NEW).readSnapshot()).toEqual(bytes(9))
    expect(root.dirs.get("users")?.dirs.has("bob")).toBe(true)
  })

  it("does nothing when there is no old store", async () => {
    expect(await adoptLegacyOpfsStore(OLD, NEW)).toBe(false)
    expect(root.dirs.has("accounts")).toBe(false)
  })

  it("runs again after a copy that stopped before the snapshot", async () => {
    await new OpfsStorage(OLD).writeSnapshot(bytes(7))
    // A crash log alone under the new path: an earlier move got that far.
    await new OpfsStorage(NEW).appendPending('{"op":"partial"}')

    expect(await adoptLegacyOpfsStore(OLD, NEW)).toBe(true)
    expect(await new OpfsStorage(NEW).readSnapshot()).toEqual(bytes(7))
    // The old store had no crash log, so the partial one is replaced by an
    // empty log, not replayed on top of the moved snapshot.
    expect(await new OpfsStorage(NEW).readPending()).toEqual([])
  })
})
