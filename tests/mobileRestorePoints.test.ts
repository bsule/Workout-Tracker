/**
 * Mobile restore points on the engine (mobile/src/store/restorePoints.ts):
 * a capture 30 seconds after the last edit and on demand, the slot list read
 * from the engine, and a restore pinned to the version it was asked against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const engine = vi.hoisted(() => ({
  commit: null as null | (() => void),
  session: null as null | Record<string, any>,
}))

vi.mock("../mobile/src/engine/mobileEngine", () => ({
  mobileSessions: {
    get session() {
      return engine.session
    },
  },
  onEngineCommit: (listener: () => void) => {
    engine.commit = listener
    return () => {}
  },
}))

function fakeSession() {
  return {
    accountKey: "1",
    data: {
      saveRestorePoint: vi.fn(async () => {}),
      restorePoints: vi.fn(async () => ({
        current: { savedAt: "2026-09-21T08:00:00Z", workouts: 4, sets: 20, generation: 1, revision: 9 },
        bak: { savedAt: "2026-09-21T07:00:00Z", workouts: 3, sets: 15 },
        bak2: { savedAt: "2026-09-20T07:00:00Z" },
        junk: 1,
      })),
      currentVersion: vi.fn(async () => ({ generation: 1, revision: 9 })),
      restore: vi.fn(async () => ({ command_id: "r", generation: 2, revision: 10, result: null })),
    },
  }
}

let rp: typeof import("../mobile/src/store/restorePoints")

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  engine.session = fakeSession()
  rp = await import("../mobile/src/store/restorePoints")
})

afterEach(() => {
  vi.useRealTimers()
})

describe("restore point captures", () => {
  it("saves once, 30 seconds after the last edit", async () => {
    engine.commit!()
    vi.advanceTimersByTime(20_000)
    engine.commit!()
    vi.advanceTimersByTime(29_000)
    expect(engine.session!.data.saveRestorePoint).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(engine.session!.data.saveRestorePoint).toHaveBeenCalledOnce()
  })

  it("saves at once when the app leaves the foreground, and only when edits wait", async () => {
    await rp.saveRestorePointNow()
    expect(engine.session!.data.saveRestorePoint).not.toHaveBeenCalled()
    engine.commit!()
    await rp.saveRestorePointNow()
    expect(engine.session!.data.saveRestorePoint).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.session!.data.saveRestorePoint).toHaveBeenCalledOnce()
  })

  it("never saves an edit of one account into the next", async () => {
    const first = engine.session!
    engine.commit!()
    engine.session = fakeSession()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(first.data.saveRestorePoint).not.toHaveBeenCalled()
    expect(engine.session!.data.saveRestorePoint).not.toHaveBeenCalled()
  })
})

describe("restore points", () => {
  it("lists the slots with their time and counts, unknown counts as null", async () => {
    expect(await rp.listRestorePoints()).toEqual({
      current: { savedAt: "2026-09-21T08:00:00Z", workouts: 4, sets: 20 },
      bak: { savedAt: "2026-09-21T07:00:00Z", workouts: 3, sets: 15 },
      bak2: { savedAt: "2026-09-20T07:00:00Z", workouts: null, sets: null },
    })
  })

  it("restores against the committed version and drops a waiting capture", async () => {
    engine.commit!()
    await rp.restoreFromSlot("bak2")
    expect(engine.session!.data.restore).toHaveBeenCalledWith("bak2", 1, 9)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(engine.session!.data.saveRestorePoint).not.toHaveBeenCalled()
  })

  it("refuses when the account changed while the version was read", async () => {
    const first = engine.session!
    let release!: (v: { generation: number; revision: number }) => void
    first.data.currentVersion.mockImplementation(() => new Promise((r) => (release = r)))
    const restoring = rp.restoreFromSlot("bak")
    engine.session = fakeSession()
    release({ generation: 1, revision: 9 })
    await expect(restoring).rejects.toThrow("account changed")
    expect(first.data.restore).not.toHaveBeenCalled()
  })

  it("says so when no account is open", async () => {
    engine.session = null
    await expect(rp.listRestorePoints()).rejects.toThrow("No local store is open")
  })
})
