/**
 * The mobile restore points end to end: RnFsStorage's file moves and
 * metadata, and restoreFromSlot() through the real @lift/core persist layer.
 * expo-file-system is replaced by an in-memory disk that keeps mtimes across
 * moves and, like the iOS implementation, refuses to move onto an existing
 * file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const disk = vi.hoisted(() => ({
  files: new Map<string, { data: string; mtime: number }>(),
  dirs: new Set<string>(),
}))

vi.mock("expo-file-system/legacy", () => {
  const exists = (p: string) =>
    disk.files.has(p) ||
    disk.dirs.has(p) ||
    [...disk.files.keys()].some((k) => k.startsWith(p.endsWith("/") ? p : p + "/"))
  return {
    documentDirectory: "file:///docs/",
    EncodingType: { Base64: "base64", UTF8: "utf8" },
    async getInfoAsync(p: string) {
      const f = disk.files.get(p)
      if (f) return { exists: true, isDirectory: false, modificationTime: f.mtime }
      return exists(p) ? { exists: true, isDirectory: true, modificationTime: 0 } : { exists: false }
    },
    async makeDirectoryAsync(p: string) {
      disk.dirs.add(p)
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
      const f = disk.files.get(from)
      if (!f) throw new Error(`no file ${from}`)
      if (disk.files.has(to)) throw new Error(`${to} exists`)
      disk.files.delete(from)
      disk.files.set(to, f)
    },
  }
})

import {
  configure,
  flushNow,
  hydrate,
  setStorageFactory,
  snapshotStats,
} from "@lift/core/store/persist"
import { parse, serialize } from "@lift/core/store/blob"
import type { Snapshot } from "@lift/core/store/schema"
import { RnFsStorage, createActiveStorage } from "../mobile/src/store/storage"
import { listRestorePoints, restoreFromSlot } from "../mobile/src/store/restorePoints"
import type { Slot } from "../mobile/src/store/snapshotRotation"
import { currentSnapshot, loadSnapshot, resetStore } from "./helpers/store"
import { getState } from "@lift/core/store/store"
import { blankSnapshot, workout } from "./helpers/build"

const HOUR = 60 * 60 * 1000
const T0 = new Date("2026-09-21T08:00:00.000Z").getTime()
const DIR = "file:///docs/lift/users_tester/"

/** A snapshot you can recognise by its workout count. */
function withWorkouts(n: number): Snapshot {
  const snap = blankSnapshot()
  snap.workouts = Array.from({ length: n }, (_, i) => workout(i + 1, `2026-09-${String(i + 1).padStart(2, "0")}`))
  return snap
}

async function save(storage: RnFsStorage, n: number) {
  const snap = withWorkouts(n)
  await storage.writeSnapshot(await serialize(snap), snapshotStats(snap))
}

async function workoutsIn(storage: RnFsStorage, slot: Slot): Promise<number | null> {
  const bytes = await storage.readSlot(slot)
  return bytes ? (await parse(bytes)).snapshot.workouts.length : null
}

async function slots(storage: RnFsStorage) {
  return {
    current: await workoutsIn(storage, "current"),
    bak: await workoutsIn(storage, "bak"),
    bak2: await workoutsIn(storage, "bak2"),
  }
}

beforeEach(() => {
  disk.files.clear()
  disk.dirs.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RnFsStorage rotation", () => {
  it("fills .bak then .bak2, then holds .bak2 for a day", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    expect(await slots(s)).toEqual({ current: 1, bak: null, bak2: null })

    vi.setSystemTime(T0 + 60_000)
    await save(s, 2)
    expect(await slots(s)).toEqual({ current: 2, bak: 1, bak2: null })

    vi.setSystemTime(T0 + 2 * 60_000)
    await save(s, 3)
    expect(await slots(s)).toEqual({ current: 3, bak: 2, bak2: 1 })

    // Many saves inside the day: .bak keeps moving, .bak2 does not.
    for (let n = 4; n <= 8; n++) {
      vi.setSystemTime(T0 + n * HOUR)
      await save(s, n)
    }
    expect(await slots(s)).toEqual({ current: 8, bak: 7, bak2: 1 })

    // A day after .bak2 was filled, the next save moves .bak into it.
    vi.setSystemTime(T0 + 2 * 60_000 + 24 * HOUR)
    await save(s, 9)
    expect(await slots(s)).toEqual({ current: 9, bak: 8, bak2: 7 })
    expect([...disk.files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false)
  })

  it("labels each file with the time and counts of the data in it", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    vi.setSystemTime(T0 + 60_000)
    await save(s, 2)
    vi.setSystemTime(T0 + 2 * 60_000)
    await save(s, 3)

    const meta = await s.listRestorePoints()
    expect(meta.current).toMatchObject({ workouts: 3, savedAt: new Date(T0 + 2 * 60_000).toISOString() })
    expect(meta.bak).toMatchObject({ workouts: 2, savedAt: new Date(T0 + 60_000).toISOString() })
    expect(meta.bak2).toMatchObject({ workouts: 1, savedAt: new Date(T0).toISOString() })
  })

  it("falls back to .bak, then .bak2, when the newer files are gone", async () => {
    const s = new RnFsStorage("users/tester")
    for (let n = 1; n <= 3; n++) {
      vi.setSystemTime(T0 + n * 60_000)
      await save(s, n)
    }
    disk.files.delete(DIR + "snapshot.bin")
    expect((await parse((await s.readSnapshot())!)).snapshot.workouts).toHaveLength(2)
    disk.files.delete(DIR + "snapshot.bin.bak")
    expect((await parse((await s.readSnapshot())!)).snapshot.workouts).toHaveLength(1)
  })

  it("shows a file with a lost or stale label by its mtime, with unknown counts", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    vi.setSystemTime(T0 + 60_000)
    await save(s, 2)
    // A kill after the moves but before the metadata write leaves the old
    // labels: here the file now in .bak still carries no entry of its own.
    disk.files.delete(DIR + "restore-points.json")
    const meta = await s.listRestorePoints()
    expect(meta.bak).toEqual({ savedAt: new Date(T0).toISOString(), workouts: null, sets: null })
  })
})

describe("hydrate with a damaged snapshot.bin", () => {
  function reopen() {
    resetStore()
    setStorageFactory(createActiveStorage)
    configure("users/other")
    configure("users/tester")
  }

  it("moves damaged copies aside so they never enter the restore slots", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    vi.setSystemTime(T0 + 60_000)
    await save(s, 2)
    vi.setSystemTime(T0 + 2 * 60_000)
    await save(s, 3) // current 3, bak 2, bak2 1
    disk.files.set(DIR + "snapshot.bin", { data: "bm90IGd6aXA=", mtime: T0 / 1000 + 180 })
    disk.files.set(DIR + "snapshot.bin.bak", { data: "bm90IGd6aXA=", mtime: T0 / 1000 + 180 })

    reopen()
    vi.setSystemTime(T0 + 48 * HOUR) // .bak2 long past a day
    await hydrate()

    expect(currentSnapshot().workouts).toHaveLength(1)
    // The one good copy is still in .bak2, next to the rewritten current.
    expect(await slots(s)).toEqual({ current: 1, bak: null, bak2: 1 })
    expect(disk.files.has(DIR + "snapshot.bin.corrupt")).toBe(true)
    expect(disk.files.has(DIR + "snapshot.bin.bak.corrupt")).toBe(true)
  })

  it("does not load an older copy, or write anything, when the newest was saved by a newer build", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    vi.setSystemTime(T0 + 60_000)
    const future = { ...withWorkouts(7), schema_version: 999 }
    // serialize() stamps the current version; write the newer blob by hand.
    const { gzipSync, strToU8 } = await import("fflate")
    const bytes = gzipSync(strToU8(JSON.stringify(future)))
    await s.writeSnapshot(bytes)
    const before = new Map(disk.files)

    reopen()
    await expect(hydrate()).rejects.toThrow(/newer/)
    expect(getState().hydrated).toBe(false)
    await flushNow()
    expect(disk.files).toEqual(before)
  })

  // The damaged copies are logged on purpose; keep the run output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads .bak and writes it back as snapshot.bin", async () => {
    const s = new RnFsStorage("users/tester")
    await save(s, 1)
    vi.setSystemTime(T0 + 60_000)
    await save(s, 2)
    // Reads fine, does not decode.
    disk.files.set(DIR + "snapshot.bin", { data: "bm90IGd6aXA=", mtime: T0 / 1000 + 120 })

    resetStore()
    setStorageFactory(createActiveStorage)
    configure("users/other")
    configure("users/tester")
    vi.setSystemTime(T0 + 5 * 60_000)
    await hydrate()

    expect(currentSnapshot().workouts).toHaveLength(1)
    expect(await workoutsIn(s, "current")).toBe(1)
  })
})

describe("restoreFromSlot", () => {
  beforeEach(() => {
    resetStore()
    setStorageFactory(createActiveStorage)
    configure("users/other") // a switch, so "users/tester" gets a fresh adapter
    configure("users/tester")
  })

  async function flushWith(n: number, at: number) {
    vi.setSystemTime(at)
    loadSnapshot(withWorkouts(n))
    await flushNow()
  }

  it("restores the daily copy, keeps it in place, and can be undone", async () => {
    await flushWith(1, T0)
    await flushWith(2, T0 + 60_000)
    await flushWith(3, T0 + 2 * 60_000) // .bak2 = 1
    await flushWith(4, T0 + 30 * HOUR) // .bak2 expired: now holds 2

    const storage = new RnFsStorage("users/tester")
    expect(await slots(storage)).toEqual({ current: 4, bak: 3, bak2: 2 })

    // The data on screen has an edit the last flush has not written yet.
    loadSnapshot(withWorkouts(5))
    vi.setSystemTime(T0 + 60 * HOUR) // .bak2 is well past a day old
    await restoreFromSlot("bak2")

    expect(currentSnapshot().workouts).toHaveLength(2)
    // The restore's own write did not move .bak into the daily slot.
    expect(await slots(storage)).toEqual({ current: 2, bak: 4, bak2: 2 })
    // Undo holds what was on screen, including the unflushed edit.
    expect(await workoutsIn(storage, "undo")).toBe(5)
    expect((await listRestorePoints()).undo).toMatchObject({ workouts: 5 })

    await restoreFromSlot("undo")
    expect(currentSnapshot().workouts).toHaveLength(5)
  })

  it("a second restore with no edits in between keeps the data from before the first", async () => {
    await flushWith(1, T0)
    await flushWith(2, T0 + 60_000)
    await flushWith(3, T0 + 2 * 60_000) // .bak2 = 1, .bak = 2
    const storage = new RnFsStorage("users/tester")

    loadSnapshot(withWorkouts(4))
    await restoreFromSlot("bak2")
    // A double tap, or "it didn't seem to work": the same restore again.
    await restoreFromSlot("bak2")
    expect(currentSnapshot().workouts).toHaveLength(1)
    expect(await workoutsIn(storage, "undo")).toBe(4)

    // An edit after a restore makes the next restore save it to undo.
    loadSnapshot(withWorkouts(6))
    await restoreFromSlot("bak2")
    expect(await workoutsIn(storage, "undo")).toBe(6)
  })

  it("changes nothing when the chosen file is damaged", async () => {
    await flushWith(1, T0)
    await flushWith(2, T0 + 60_000)
    disk.files.set(DIR + "snapshot.bin.bak", { data: "bm90IGd6aXA=", mtime: T0 / 1000 })

    await expect(restoreFromSlot("bak")).rejects.toThrow()
    expect(currentSnapshot().workouts).toHaveLength(2)
    expect(disk.files.has(DIR + "snapshot.bin.undo")).toBe(false)
  })
})

describe("restore account isolation", () => {
  it("cancels a restore when accounts change while the file is being read", async () => {
    setStorageFactory(createActiveStorage)
    configure("users/other")
    configure("users/tester")
    loadSnapshot(withWorkouts(1))
    await flushNow()
    loadSnapshot(withWorkouts(2))
    await flushNow()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const original = RnFsStorage.prototype.readSlot
    const spy = vi.spyOn(RnFsStorage.prototype, "readSlot").mockImplementation(async function (slot) {
      const bytes = await original.call(this, slot)
      await gate
      return bytes
    })
    try {
      const restoring = restoreFromSlot("bak")
      configure("users/another")
      await hydrate()
      const before = new Map(disk.files)
      release()
      await expect(restoring).rejects.toThrow("account changed")
      expect(currentSnapshot().workouts).toEqual([])
      expect(disk.files).toEqual(before)
    } finally {
      release()
      spy.mockRestore()
    }
  })
})
