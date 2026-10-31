import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RecoveryStorage } from "../frontend/lib/store/storage/recovery"
import { IdbStorage } from "../frontend/lib/store/storage/idb"
import { configure, hydrate, replaceSnapshotFromBytes, setStorageFactory, snapshotStats, unload } from "@lift/core/store/persist"
import { parse, serialize } from "@lift/core/store/blob"
import { getState, markHydrated } from "@lift/core/store/store"
import { blankSnapshot, workout } from "./helpers/build"
import { memoryStorage } from "./helpers/store"

function snap(id: number) {
  const s = blankSnapshot()
  s.workouts = [workout(id, `2026-10-${String(id).padStart(2, "0")}`)]
  return s
}
async function workoutId(bytes: Uint8Array | null) {
  return bytes ? (await parse(bytes)).snapshot.workouts[0]?.id : null
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"))
})
afterEach(async () => { await unload(); vi.useRealTimers(); vi.restoreAllMocks() })

describe("browser restore points", () => {
  it("keeps previous and daily copies across adapter instances, isolated per account", async () => {
    const a = new RecoveryStorage("account-a", new IdbStorage("account-a"))
    await a.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"))
    await a.writeSnapshot(await serialize(snap(2)), snapshotStats(snap(2)))
    vi.setSystemTime(new Date("2026-10-14T14:00:00Z"))
    await a.writeSnapshot(await serialize(snap(3)), snapshotStats(snap(3)))
    const reopened = new RecoveryStorage("account-a", new IdbStorage("account-a"))
    expect(await workoutId(await reopened.readSlot("previous"))).toBe(2)
    expect(await workoutId(await reopened.readSlot("daily"))).toBe(1)
    expect((await reopened.list()).previous?.workouts).toBe(1)
    expect(await new RecoveryStorage("account-b", memoryStorage()).list()).toEqual({})
  })

  it("saves the in-memory outgoing data before cloud replacement, including unflushed edits", async () => {
    const storage = new RecoveryStorage("cloud", memoryStorage())
    setStorageFactory(() => storage)
    configure("cloud")
    await storage.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    markHydrated(snap(2))
    await storage.appendPending('{"op":"not-yet-flushed"}')
    await replaceSnapshotFromBytes(await serialize(snap(3)))
    expect(await workoutId(await storage.readSlot("undo"))).toBe(2)
    expect(await storage.readPending()).toEqual([])
    expect(getState().snapshot.workouts[0].id).toBe(3)
  })

  it("aborts replacement without changing current data or the crash log if undo cannot be saved", async () => {
    const base = memoryStorage()
    const storage = new RecoveryStorage("failed-undo", base)
    setStorageFactory(() => storage)
    configure("failed-undo")
    markHydrated(snap(1))
    await storage.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    await storage.appendPending("pending")
    vi.spyOn(storage, "saveUndo").mockRejectedValue(new Error("disk full"))
    await expect(replaceSnapshotFromBytes(await serialize(snap(2)))).rejects.toThrow("disk full")
    expect(getState().snapshot.workouts[0].id).toBe(1)
    expect(await workoutId(await base.readSnapshot())).toBe(1)
    expect(await storage.readPending()).toEqual(["pending"])
  })

  it("restores a daily copy without rotating it away and preserves the original undo on repeated restores", async () => {
    const storage = new RecoveryStorage("restore", memoryStorage())
    setStorageFactory(() => storage)
    configure("restore")
    await storage.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"))
    await storage.writeSnapshot(await serialize(snap(2)), snapshotStats(snap(2)))
    const daily = (await storage.readSlot("daily"))!
    markHydrated(snap(3))
    vi.setSystemTime(new Date("2026-10-16T13:00:00Z"))
    await storage.restoring(() => replaceSnapshotFromBytes(daily))
    expect(await workoutId(await storage.readSlot("undo"))).toBe(3)
    expect(await workoutId(await storage.readSlot("daily"))).toBe(1)
    await storage.restoring(() => replaceSnapshotFromBytes(daily), true)
    expect(await workoutId(await storage.readSlot("undo"))).toBe(3)
  })

  it("recovers a damaged current snapshot without rotating the damaged bytes into previous", async () => {
    const base = memoryStorage()
    const storage = new RecoveryStorage("corrupt", base)
    await storage.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    await storage.writeSnapshot(await serialize(snap(2)), snapshotStats(snap(2)))
    await base.writeSnapshot(new Uint8Array([1, 2, 3]))
    setStorageFactory(() => storage)
    configure("corrupt")
    vi.spyOn(console, "error").mockImplementation(() => {})
    await hydrate()
    expect(getState().snapshot.workouts[0].id).toBe(1)
    expect(await workoutId(await storage.readSnapshot())).toBe(1)
    expect(await workoutId(await storage.readSlot("previous"))).toBe(1)
  })

  it("keeps a committed recovery copy if the main snapshot write fails", async () => {
    const base = memoryStorage()
    const storage = new RecoveryStorage("failed-main", base)
    await storage.writeSnapshot(await serialize(snap(1)), snapshotStats(snap(1)))
    vi.spyOn(base, "writeSnapshot").mockRejectedValueOnce(new Error("write failed"))
    await expect(storage.writeSnapshot(await serialize(snap(2)), snapshotStats(snap(2)))).rejects.toThrow("write failed")
    expect(await workoutId(await storage.readSnapshot())).toBe(1)
    expect(await workoutId(await storage.readSlot("previous"))).toBe(1)
  })
})
