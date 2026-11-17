/**
 * Data-safety regressions in the web save and sync path:
 * - taking the cloud copy adopts its etag only once the copy is applied,
 * - a failed consolidation save after hydrate does not fail the load,
 * - OPFS is picked only when it can write (createWritable),
 * - an IndexedDB write resolves on commit, not on request success,
 * - sign-out detaches the store even when its final save fails, so no retry
 *   from this tab writes after another tab takes the editor lock.
 */
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CloudflareTransport, autoSync, configureSyncClock } from "@lift/core"
import * as syncModule from "@lift/core/sync"
import { parse, serialize } from "@lift/core/store/blob"
import { SCHEMA_VERSION } from "@lift/core/store/schema"
import * as M from "@lift/core/store/mutations"
import { configure, flushNow, hydrate, setStorageFactory, unload } from "@lift/core/store/persist"
import { getState } from "@lift/core/store/store"
import { IdbStorage } from "../frontend/lib/store/storage/idb"
import { isOpfsAvailable } from "../frontend/lib/store/storage/opfs"
import { blankSnapshot, exercise, workout } from "./helpers/build"
import { memoryStorage, resetStore, type MemoryStorage } from "./helpers/store"

let counter = 0
const freshKey = () => `save-safety-${counter++}`

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(async () => {
  await unload().catch(() => {})
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---- 1. pull and replace -----------------------------------------------------

describe("pullAndReplace", () => {
  let cloud: { bytes: Uint8Array; etag: string } | null
  let version: number
  let transport: CloudflareTransport
  const realFetch = globalThis.fetch

  beforeEach(() => {
    const storages = new Map<string, MemoryStorage>()
    setStorageFactory((key) => storages.get(key) ?? storages.set(key, memoryStorage()).get(key)!)
    configure(freshKey())
    resetStore()
    configureSyncClock(null)
    autoSync._resetAutoSyncState()
    cloud = null
    version = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/sync/snapshot")) return new Response(null, { status: 404 })
      if (!init?.method || init.method === "GET") {
        if (!cloud) return new Response(null, { status: 204 })
        return new Response(cloud.bytes, { status: 200, headers: { etag: `"${cloud.etag}"` } })
      }
      const headers = new Headers(init.headers)
      const current = cloud?.etag ?? null
      const ok = headers.get("If-None-Match") === "*"
        ? current == null
        : headers.get("If-Match")?.replace(/"/g, "") === current
      if (!ok) return Response.json({ etag: current }, { status: 412 })
      cloud = { bytes: new Uint8Array(init.body as ArrayBuffer), etag: `v${++version}` }
      return Response.json({ etag: cloud.etag, quota: { used: 1, limit: 5, remaining: 4, resets_at: "x" } })
    }) as typeof fetch
    transport = new CloudflareTransport({ apiBase: "http://localhost:8787/api", getToken: () => "t" })
    syncModule.configureSync(transport)
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    syncModule.configureSync(null)
  })

  it("keeps the old etag when the cloud copy cannot be applied, so the next push is still refused", async () => {
    M.createWorkout("2026-05-01")
    expect((await autoSync.syncNow()).kind).toBe("pushed")
    const mine = transport.getEtag()
    // A newer app on another device pushed a copy this build cannot read.
    const newer = { ...blankSnapshot(), workouts: [workout(900, "2026-06-01")], schema_version: SCHEMA_VERSION + 1 }
    const json = new TextEncoder().encode(JSON.stringify(newer))
    const { gzipSync } = await import("fflate")
    cloud = { bytes: gzipSync(json), etag: `v${++version}` }
    const theirs = cloud.etag

    await expect(autoSync.pullAndReplace()).rejects.toThrow("newer")
    expect(transport.getEtag()).toBe(mine)
    expect((await autoSync.syncNow()).kind).toBe("stale")
    expect(cloud.etag).toBe(theirs)
  })

  it("adopts the cloud etag once the copy is applied", async () => {
    const other = blankSnapshot()
    other.workouts = [workout(900, "2026-06-01")]
    cloud = { bytes: await serialize(other), etag: `v${++version}` }
    expect(await autoSync.pullAndReplace()).toBe(true)
    expect(getState().snapshot.workouts.map((w) => w.id)).toEqual([900])
    expect(transport.getEtag()).toBe(cloud.etag)
    M.createWorkout("2026-06-02")
    expect((await autoSync.syncNow()).kind).toBe("pushed")
  })
})

// ---- 2. hydrate and a failing consolidation save --------------------------

describe("hydrate with a failing save", () => {
  it("still loads after replaying the crash log, and keeps the log for the retry", async () => {
    const base = memoryStorage()
    const snap = blankSnapshot()
    snap.exercises = [exercise(1, "On disk")]
    await base.writeSnapshot(await serialize(snap))
    const op = JSON.stringify({ op: "create_exercise", row: exercise(2, "In the log") })
    base.pending.push(op)
    const write = vi.fn(base.writeSnapshot).mockRejectedValueOnce(new Error("Disk full"))
    setStorageFactory(() => ({ ...base, writeSnapshot: write }))
    configure(freshKey())

    await expect(hydrate()).resolves.toBeUndefined()
    expect(getState().hydrated).toBe(true)
    expect(getState().snapshot.exercises.map((e) => e.name)).toEqual(["On disk", "In the log"])
    expect(base.pending).toEqual([op])
    // The next save succeeds and consolidates.
    await flushNow()
    expect(base.pending).toEqual([])
    expect((await parse(base.lastWritten!)).snapshot.exercises).toHaveLength(2)
  })

  it("still loads a new store whose first save fails", async () => {
    const base = memoryStorage()
    setStorageFactory(() => ({ ...base, writeSnapshot: vi.fn().mockRejectedValue(new Error("Disk full")) }))
    configure(freshKey())
    await expect(hydrate()).resolves.toBeUndefined()
    expect(getState().hydrated).toBe(true)
  })
})

// ---- 4. OPFS detection --------------------------------------------------------

describe("isOpfsAvailable", () => {
  it("requires createWritable on file handles", () => {
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({}) } })
    vi.stubGlobal("FileSystemFileHandle", class {})
    expect(isOpfsAvailable()).toBe(false)
    vi.stubGlobal("FileSystemFileHandle", class { createWritable() {} })
    expect(isOpfsAvailable()).toBe(true)
  })
})

// ---- 5. IndexedDB commit -------------------------------------------------------

describe("IdbStorage", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it("rejects a write whose transaction aborts after the request succeeded", async () => {
    const storage = new IdbStorage("accounts/1")
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args as Parameters<typeof put>)
      // The commit fails (for example over quota) after the put itself succeeded.
      request.addEventListener("success", () => this.transaction.abort())
      return request
    })
    await expect(storage.writeSnapshot(new Uint8Array([1, 2]))).rejects.toBeTruthy()
    await expect(storage.appendPending("line")).rejects.toBeTruthy()
    spy.mockRestore()
    expect(await storage.readSnapshot()).toBeNull()
    expect(await storage.readPending()).toEqual([])
  })

  it("does not clear the crash log when the snapshot commit aborts", async () => {
    const base = new IdbStorage(freshKey())
    setStorageFactory(() => base)
    configure(freshKey())
    await hydrate()
    M.createExercise({ name: "Unsaved", category: "chest" })
    await vi.waitFor(async () => expect(await base.readPending()).toHaveLength(1))
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args as Parameters<typeof put>)
      request.addEventListener("success", () => this.transaction.abort())
      return request
    })
    await expect(flushNow()).rejects.toBeTruthy()
    spy.mockRestore()
    expect(await base.readPending()).toHaveLength(1)
  })
})

// ---- 6. unload after a failed final save ---------------------------------

describe("unload with a failing final save", () => {
  it("detaches: no retry writes after the lock is released, and the edits stay in the crash log", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const base = memoryStorage()
    let failing = false
    const write = vi.fn(async (bytes: Uint8Array) => {
      if (failing) throw new Error("Disk full")
      await base.writeSnapshot(bytes)
    })
    const key = freshKey()
    setStorageFactory(() => ({ ...base, writeSnapshot: write }))
    configure(key)
    await hydrate()
    M.createExercise({ name: "Logged before sign-out", category: "chest" })
    await vi.waitFor(() => expect(base.pending).toHaveLength(1))

    failing = true
    write.mockClear()
    await expect(unload()).rejects.toThrow("Disk full")
    expect(getState().hydrated).toBe(false)
    const attempts = write.mock.calls.length

    // Another tab now owns the store. Nothing from this one may land.
    failing = false
    await vi.advanceTimersByTimeAsync(120_000)
    expect(write.mock.calls.length).toBe(attempts)
    M.createExercise({ name: "After detach", category: "chest" })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(write.mock.calls.length).toBe(attempts)
    expect(base.pending).toHaveLength(1)

    // The next owner replays the edit from the crash log.
    resetStore()
    configure(key)
    await hydrate()
    expect(getState().snapshot.exercises.map((e) => e.name)).toEqual(["Logged before sign-out"])
  })

  it("refuses a save requested after detaching, so an import cannot report success", async () => {
    const base = memoryStorage()
    setStorageFactory(() => ({ ...base, writeSnapshot: vi.fn().mockRejectedValue(new Error("Disk full")) }))
    configure(freshKey())
    await hydrate()
    await unload().catch(() => {})
    M.createExercise({ name: "Late import row", category: "chest" })
    await expect(flushNow()).rejects.toThrow()
  })
})
