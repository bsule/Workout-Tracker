/**
 * The local store is keyed by user id, not username (@lift/core/store/paths),
 * so renaming the account keeps its data. A store an older build kept under
 * the username moves over once, before the account's engine opens on mobile
 * (mobile/src/engine/openEngine.ts, adoptLegacyStore in storage.ts). The
 * engine then reads that folder's snapshot files once, to migrate them.
 *
 * expo-file-system is an in-memory disk whose moveAsync renames a whole
 * directory, and, like the real one, refuses to move onto an existing path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const disk = vi.hoisted(() => ({
  files: new Map<string, { data: string; mtime: number }>(),
  dirs: new Set<string>(),
  failMoves: false,
}))

vi.mock("expo-file-system/legacy", () => {
  const under = (p: string) => (p.endsWith("/") ? p : p + "/")
  const exists = (p: string) =>
    disk.files.has(p) ||
    disk.dirs.has(p) ||
    disk.dirs.has(under(p)) ||
    [...disk.files.keys()].some((k) => k.startsWith(under(p)))
  return {
    documentDirectory: "file:///docs/",
    EncodingType: { Base64: "base64", UTF8: "utf8" },
    async getInfoAsync(p: string) {
      const f = disk.files.get(p)
      if (f) return { exists: true, isDirectory: false, modificationTime: f.mtime }
      return exists(p) ? { exists: true, isDirectory: true, modificationTime: 0 } : { exists: false }
    },
    async makeDirectoryAsync(p: string) {
      disk.dirs.add(under(p))
    },
    async writeAsStringAsync(p: string, data: string) {
      disk.files.set(p, { data, mtime: Date.now() / 1000 })
    },
    async readAsStringAsync(p: string) {
      const f = disk.files.get(p)
      if (!f) throw new Error(`no file ${p}`)
      return f.data
    },
    async deleteAsync(p: string, opts?: { idempotent?: boolean }) {
      if (!disk.files.delete(p) && !opts?.idempotent) throw new Error(`no file ${p}`)
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      if (disk.failMoves) throw new Error("disk full")
      if (exists(to)) throw new Error(`${to} exists`)
      const f = disk.files.get(from)
      if (f) {
        disk.files.delete(from)
        disk.files.set(to, f)
        return
      }
      // A directory: move every file and directory under it.
      const src = under(from)
      const dst = under(to)
      if (!exists(from)) throw new Error(`no such path ${from}`)
      for (const [k, v] of [...disk.files]) {
        if (!k.startsWith(src)) continue
        disk.files.delete(k)
        disk.files.set(dst + k.slice(src.length), v)
      }
      for (const d of [...disk.dirs]) {
        if (!d.startsWith(src)) continue
        disk.dirs.delete(d)
        disk.dirs.add(dst + d.slice(src.length))
      }
    },
  }
})

import { snapshotStats } from "@lift/core/store/persist"
import { serialize, parse } from "@lift/core/store/blob"
import { accountStorePath, legacyStorePath } from "@lift/core/store/paths"
import { accountDirUri, adoptLegacyStore, RnFsStorage } from "../mobile/src/store/storage"
import { createEngineOpener } from "../mobile/src/engine/openEngine"
import { blankSnapshot, workout } from "./helpers/build"

const ROOT = "file:///docs/lift/"

async function seedStore(subPath: string, workouts: number) {
  const snap = blankSnapshot()
  snap.workouts = Array.from({ length: workouts }, (_, i) =>
    workout(i + 1, `2026-09-${String(i + 1).padStart(2, "0")}`)
  )
  const storage = new RnFsStorage(subPath)
  await storage.writeSnapshot(await serialize(snap), snapshotStats(snap))
}

function filesUnder(dir: string): string[] {
  return [...disk.files.keys()].filter((k) => k.startsWith(ROOT + dir + "/")).sort()
}

/** What the native open sees: the path, and the workouts the engine would
 *  migrate from the snapshot next to it (null when there is none). */
let opened: { path: string; workouts: number | null }[] = []

const open = createEngineOpener({
  adoptLegacyStore,
  accountDirUri,
  deviceId: async () => "install-1234",
  legacyEtag: async () => null,
  async open(_session, path) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1)
    const file = disk.files.get(dir + "snapshot.bin")
    const workouts = file
      ? (await parse(Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0)))).snapshot.workouts.length
      : null
    opened.push({ path, workouts })
    return {
      transport: { query: async () => ({ generation: 1, revision: 0, data: null }), execute: async () => { throw Error("unused") }, close: async () => {} },
      generation: 1,
      revision: 0,
    }
  },
  now: () => "2026-09-21T08:00:00.000Z",
})

function bootstrapForUser(user: { id: number; username: string }) {
  return open(String(user.id), "test", { username: user.username })
}

beforeEach(() => {
  disk.files.clear()
  disk.dirs.clear()
  disk.failMoves = false
  opened = []
})

describe("store paths", () => {
  it("keys the account store by id and the old one by username", () => {
    expect(accountStorePath(42)).toBe("accounts/42")
    expect(legacyStorePath("bob")).toBe("users/bob")
  })
})

describe("mobile account store", () => {
  it("moves a username-keyed store to the id key before the engine opens", async () => {
    await seedStore(legacyStorePath("bob"), 3)
    await bootstrapForUser({ id: 7, username: "bob" })

    expect(opened).toEqual([{ path: ROOT + "accounts_7/engine.sqlite", workouts: 3 }])
    expect(filesUnder("users_bob")).toEqual([])
    expect(filesUnder("accounts_7")).toContain(ROOT + "accounts_7/snapshot.bin")
  })

  it("keeps the same store after the username changes", async () => {
    await seedStore(legacyStorePath("bob"), 2)
    await bootstrapForUser({ id: 7, username: "bob" })

    // Renamed to "rob": same id, same data. Nothing is looked up under users/rob.
    await bootstrapForUser({ id: 7, username: "rob" })
    expect(opened.map((o) => o.path)).toEqual([
      ROOT + "accounts_7/engine.sqlite",
      ROOT + "accounts_7/engine.sqlite",
    ])
    expect(opened[1].workouts).toBe(2)
  })

  it("never overwrites an account store that already exists", async () => {
    await seedStore(accountStorePath(7), 5)
    await seedStore(legacyStorePath("bob"), 1)

    expect(await adoptLegacyStore(legacyStorePath("bob"), accountStorePath(7))).toBe(false)
    await bootstrapForUser({ id: 7, username: "bob" })
    expect(opened[0].workouts).toBe(5)
    // The old folder is left alone, not merged or deleted.
    expect(filesUnder("users_bob")).toContain(ROOT + "users_bob/snapshot.bin")
  })

  it("opens an empty account when there is no old store, creating no folder first", async () => {
    expect(await adoptLegacyStore(legacyStorePath("new-user"), accountStorePath(9))).toBe(false)
    await bootstrapForUser({ id: 9, username: "new-user" })
    expect(opened).toEqual([{ path: ROOT + "accounts_9/engine.sqlite", workouts: null }])
    // The engine creates the folder itself; nothing here made one that a
    // later move would mistake for an existing account store.
    expect(disk.dirs.size).toBe(0)
  })

  it("refuses to load when the move fails, instead of showing an empty store", async () => {
    await seedStore(legacyStorePath("bob"), 3)
    disk.failMoves = true

    // The rejection is what makes StoreProvider show its load error.
    await expect(bootstrapForUser({ id: 7, username: "bob" })).rejects.toThrow("disk full")
    expect(opened).toEqual([])
    expect(filesUnder("accounts_7")).toEqual([])
    // The data is still where it was, for the next launch to move.
    expect(filesUnder("users_bob")).toContain(ROOT + "users_bob/snapshot.bin")
  })
})
