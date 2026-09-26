import { beforeEach, describe, expect, it, vi } from "vitest"

// The controller talks to React Native (Android permission) and to the
// native module through bridge.ts. Both are replaced here; what is under test
// is the order and choice of native calls.
const platform = vi.hoisted(() => ({ OS: "ios", Version: 18 }))
const perms = vi.hoisted(() => ({
  check: vi.fn(async () => false),
  request: vi.fn(async () => "granted"),
}))
vi.mock("react-native", () => ({
  Platform: platform,
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS" },
    RESULTS: { GRANTED: "granted" },
    check: perms.check,
    request: perms.request,
  },
}))

type Input = { exerciseName: string; startedAt: number; endsAt: number }
const native = vi.hoisted(() => ({
  available: true,
  shown: null as Input | null,
  calls: [] as string[],
  failNext: false,
}))
vi.mock("../mobile/src/restTimer/bridge", () => {
  const fail = () => {
    if (native.failNext) {
      native.failNext = false
      throw new Error("activity refused")
    }
  }
  return {
    isRestTimerAvailable: () => native.available,
    restTimerBridge: {
      start: async (i: Input) => {
        fail()
        native.calls.push(`start ${i.exerciseName}`)
        native.shown = i
      },
      update: async (i: Input) => {
        fail()
        native.calls.push(`update ${i.exerciseName}`)
        native.shown = i
      },
      end: async () => {
        native.calls.push("end")
        native.shown = null
      },
      current: async () => native.shown,
    },
  }
})

const T0 = Date.UTC(2026, 8, 21, 12, 0, 0)

async function load(settings: Record<string, unknown> = {}) {
  // Fresh module state (the `shown` cache, the permission flag, and the
  // store singleton) per test. Settings go through the same fresh registry
  // the controller reads from.
  vi.resetModules()
  const M = await import("@lift/core/store/mutations")
  if (Object.keys(settings).length) M.updateSettings(settings)
  return import("../mobile/src/restTimer/controller")
}

/** Waits for the controller's serial queue to drain. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  native.available = true
  native.shown = null
  native.calls = []
  native.failNext = false
  platform.OS = "ios"
  platform.Version = 18
  perms.check.mockReset().mockResolvedValue(false)
  perms.request.mockReset().mockResolvedValue("granted")
})

describe("rest timer controller", () => {
  it("starts on the first set with the default 6:00 cutoff", async () => {
    const c = await load()
    c.setLogged("Bench Press", T0)
    await settle()
    expect(native.calls).toEqual(["start Bench Press"])
    expect(native.shown).toEqual({
      exerciseName: "Bench Press",
      startedAt: T0,
      endsAt: T0 + 360_000,
    })
  })

  it("updates in place on the next set inside the cutoff", async () => {
    const c = await load()
    c.setLogged("Bench Press", T0)
    vi.setSystemTime(T0 + 90_000)
    c.setLogged("Bench Press", T0 + 90_000)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "update Bench Press"])
    expect(native.shown?.endsAt).toBe(T0 + 90_000 + 360_000)
  })

  it("starts fresh once the last timer has passed its cutoff", async () => {
    const c = await load()
    c.setLogged("Squat", T0)
    await settle()
    vi.setSystemTime(T0 + 400_000)
    c.setLogged("Squat", T0 + 400_000)
    await settle()
    expect(native.calls).toEqual(["start Squat", "start Squat"])
  })

  it("uses the stored cutoff", async () => {
    const c = await load({ rest_timer_cutoff_s: 390 })
    c.setLogged("Row", T0)
    await settle()
    expect(native.shown?.endsAt).toBe(T0 + 390_000)
  })

  it("does nothing when the feature is off", async () => {
    const c = await load({ rest_timer_activity: false })
    c.setLogged("Row", T0)
    await settle()
    expect(native.calls).toEqual([])
  })

  const DAY = "2026-09-22"

  it("reset restarts the showing timer from now without a set", async () => {
    const c = await load()
    c.setLogged("Squat", T0)
    await settle()
    vi.setSystemTime(T0 + 60_000)
    c.reset("Squat", DAY)
    await settle()
    expect(native.calls).toEqual(["start Squat", "update Squat"])
    expect(native.shown).toEqual({
      exerciseName: "Squat",
      startedAt: T0 + 60_000,
      endsAt: T0 + 60_000 + 360_000,
    })
    expect(c.getMark()).toEqual({ kind: "reset", atMs: T0 + 60_000, date: DAY })
  })

  it("reset starts a timer when none is showing", async () => {
    const c = await load()
    c.reset("Squat", DAY)
    await settle()
    expect(native.calls).toEqual(["start Squat"])
  })

  it("reset only moves the in-app mark when the feature is off", async () => {
    const c = await load({ rest_timer_activity: false })
    c.reset("Squat", DAY)
    await settle()
    expect(native.calls).toEqual([])
    expect(c.getMark()?.kind).toBe("reset")
  })

  it("stop ends the timer and a later set starts a new one", async () => {
    const c = await load()
    c.setLogged("Squat", T0)
    c.stop(DAY)
    await settle()
    expect(native.calls).toEqual(["start Squat", "end"])
    expect(c.getMark()).toEqual({ kind: "stop", atMs: T0, date: DAY })
    vi.setSystemTime(T0 + 30_000)
    c.setLogged("Squat", T0 + 30_000)
    await settle()
    expect(native.calls).toEqual(["start Squat", "end", "start Squat"])
  })

  it("clearMark forgets a reset or stop and notifies once", async () => {
    const c = await load()
    let hits = 0
    c.subscribeMark(() => hits++)
    c.stop(DAY)
    c.clearMark()
    c.clearMark()
    expect(c.getMark()).toBeNull()
    expect(hits).toBe(2)
  })

  it("turning the feature off keeps a stop in the app", async () => {
    const c = await load()
    c.stop(DAY)
    c.disable()
    expect(c.getMark()?.kind).toBe("stop")
  })

  it("notifies mark subscribers", async () => {
    const c = await load()
    let hits = 0
    const off = c.subscribeMark(() => hits++)
    c.reset("Squat", DAY)
    c.stop(DAY)
    off()
    c.reset("Squat", DAY)
    expect(hits).toBe(2)
  })

  it("ends the showing timer when turned off", async () => {
    const c = await load()
    c.setLogged("Row", T0)
    c.disable()
    await settle()
    expect(native.calls).toEqual(["start Row", "end"])
    expect(native.shown).toBeNull()
  })

  it("does nothing at all without the native module (Expo Go)", async () => {
    native.available = false
    const c = await load()
    c.setLogged("Row", T0)
    c.reconcile()
    c.disable()
    await settle()
    expect(native.calls).toEqual([])
  })

  it("never throws into the caller and starts fresh after a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const c = await load()
    c.setLogged("Row", T0)
    await settle()
    native.failNext = true
    // A failed update leaves the screen state unknown...
    expect(() => c.setLogged("Row", T0 + 1000)).not.toThrow()
    await settle()
    // ...so the next set starts rather than updates.
    c.setLogged("Row", T0 + 2000)
    await settle()
    expect(native.calls).toEqual(["start Row", "start Row"])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  describe("reconcile", () => {
    it("keeps a timer from an earlier process that is inside its cutoff", async () => {
      native.shown = { exerciseName: "Deadlift", startedAt: T0, endsAt: T0 + 360_000 }
      const c = await load()
      vi.setSystemTime(T0 + 60_000)
      c.reconcile()
      await settle()
      expect(native.calls).toEqual([])
      // And the next set updates it instead of starting a second one.
      c.setLogged("Deadlift", T0 + 60_000)
      await settle()
      expect(native.calls).toEqual(["update Deadlift"])
    })

    it("ends a timer past its cutoff", async () => {
      native.shown = { exerciseName: "Deadlift", startedAt: T0, endsAt: T0 + 360_000 }
      const c = await load()
      vi.setSystemTime(T0 + 360_000)
      c.reconcile()
      await settle()
      expect(native.calls).toEqual(["end"])
    })

    it("ends any timer when the feature is off", async () => {
      native.shown = { exerciseName: "Deadlift", startedAt: T0, endsAt: T0 + 360_000 }
      const c = await load({ rest_timer_activity: false })
      c.reconcile()
      await settle()
      expect(native.calls).toEqual(["end"])
    })

    it("does nothing when no timer is showing", async () => {
      const c = await load()
      c.reconcile()
      await settle()
      expect(native.calls).toEqual([])
    })
  })

  describe("Android notification permission", () => {
    beforeEach(() => {
      platform.OS = "android"
      platform.Version = 34
    })

    it("asks once, then posts when granted", async () => {
      const c = await load()
      c.setLogged("Row", T0)
      await settle()
      expect(perms.request).toHaveBeenCalledOnce()
      expect(native.calls).toEqual(["start Row"])
    })

    it("does not post, and does not ask again this process, when denied", async () => {
      perms.request.mockResolvedValue("denied")
      const c = await load()
      c.setLogged("Row", T0)
      await settle()
      c.setLogged("Row", T0 + 1000)
      await settle()
      expect(perms.request).toHaveBeenCalledOnce()
      expect(native.calls).toEqual([])
    })

    it("does not ask when already granted", async () => {
      perms.check.mockResolvedValue(true)
      const c = await load()
      c.setLogged("Row", T0)
      await settle()
      expect(perms.request).not.toHaveBeenCalled()
      expect(native.calls).toEqual(["start Row"])
    })

    it("does not ask below Android 13", async () => {
      platform.Version = 32
      const c = await load()
      c.setLogged("Row", T0)
      await settle()
      expect(perms.check).not.toHaveBeenCalled()
      expect(native.calls).toEqual(["start Row"])
    })

    it("asks when the user turns the feature on", async () => {
      const c = await load()
      c.enable()
      await settle()
      expect(perms.request).toHaveBeenCalledOnce()
    })
  })
})

// A set can leave the store without the controller being told: a swipe
// delete, removing the exercise, deleting the workout. The timer outside the
// app must then follow the in-app ticker instead of counting on from it.
describe("when the set the timer counts from goes", () => {
  const DAY = "2026-09-21"

  async function setup() {
    const c = await load()
    const M = await import("@lift/core/store/mutations")
    const ex = M.createExercise({ name: "Bench Press", category: "chest" })
    const w = M.createWorkout(DAY).row
    const we = M.addExerciseToWorkout(w.id, ex.id)
    // What the set logger does: the timer at the tap, the row a moment later.
    const log = (atMs: number) => {
      vi.setSystemTime(atMs)
      c.setLogged("Bench Press", atMs)
      return M.addSet(we.id, { weight: 100, reps: 5, created_at: new Date(atMs).toISOString() })
    }
    return { c, M, w, log }
  }

  it("ends the timer when its only set is deleted", async () => {
    const { M, log } = await setup()
    const set = log(T0)
    await settle()
    M.deleteSet(set.id)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "end"])
    expect(native.shown).toBeNull()
  })

  it("counts from the set before when the newest is deleted", async () => {
    const { M, log } = await setup()
    log(T0)
    const second = log(T0 + 90_000)
    await settle()
    M.deleteSet(second.id)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "update Bench Press", "update Bench Press"])
    expect(native.shown).toEqual({ exerciseName: "Bench Press", startedAt: T0, endsAt: T0 + 360_000 })
  })

  it("stays stopped when the set logged after a stop is deleted", async () => {
    const { c, M, log } = await setup()
    log(T0)
    await settle()
    vi.setSystemTime(T0 + 30_000)
    c.stop(DAY)
    const after = log(T0 + 60_000)
    await settle()
    M.deleteSet(after.id)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "end", "start Bench Press", "end"])
    expect(native.shown).toBeNull()
  })

  it("ends when the set left is past the cutoff", async () => {
    const { M, log } = await setup()
    log(T0)
    const late = log(T0 + 400_000)
    await settle()
    M.deleteSet(late.id)
    await settle()
    expect(native.calls.at(-1)).toBe("end")
  })

  it("ends when the workout is deleted", async () => {
    const { M, w, log } = await setup()
    log(T0)
    await settle()
    M.deleteWorkout(w.id)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "end"])
  })

  it("leaves the timer alone before its set has landed, and after other edits", async () => {
    const { M, log } = await setup()
    const set = log(T0)
    await settle()
    M.updateSet(set.id, { reps: 6 })
    M.createExercise({ name: "Row", category: "back" })
    await settle()
    expect(native.calls).toEqual(["start Bench Press"])
  })

  it("counts from a reset again when the set logged after it is deleted", async () => {
    const { c, M, log } = await setup()
    log(T0)
    await settle()
    vi.setSystemTime(T0 + 30_000)
    c.reset("Bench Press", DAY)
    const after = log(T0 + 60_000)
    await settle()
    M.deleteSet(after.id)
    await settle()
    expect(native.calls.at(-1)).toBe("update Bench Press")
    expect(native.shown?.startedAt).toBe(T0 + 30_000)
  })

  it("does not bring back a timer that was stopped when an older set is deleted", async () => {
    const { c, M, log } = await setup()
    const first = log(T0)
    log(T0 + 60_000)
    await settle()
    c.stop(DAY)
    M.deleteSet(first.id)
    await settle()
    expect(native.calls).toEqual(["start Bench Press", "update Bench Press", "end"])
  })
})
