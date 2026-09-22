import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  setStorageFactory,
  configure,
  hydrate,
  flushNow,
  replaceSnapshotFromBytes,
  runBatched,
  unload,
} from "@lift/core/store/persist"
import { serialize, parse } from "@lift/core/store/blob"
import { emptySnapshot } from "@lift/core/store/schema"
import * as M from "@lift/core/store/mutations"
import { getState } from "@lift/core/store/store"
import type { BlobStorage } from "@lift/core/store/storage"
import {
  currentSnapshot,
  loadSnapshot,
  memoryStorage,
  resetStore,
  type MemoryStorage,
} from "./helpers/store"
import { blankSnapshot, exercise, set, we, workout } from "./helpers/build"

// A factory whose instances we keep a handle on, so each test can pre-seed and
// inspect the bytes for its own namespaced sub-path.
const storages = new Map<string, MemoryStorage>()
function storageFor(subPath: string): MemoryStorage {
  let s = storages.get(subPath)
  if (!s) {
    s = memoryStorage()
    storages.set(subPath, s)
  }
  return s
}

beforeEach(() => {
  storages.clear()
  setStorageFactory(storageFor)
  // Tests that hydrate() leave the replayed snapshot in the singleton store;
  // without this the next test's flushNow() writes the previous test's rows.
  resetStore()
})

// Unique sub-path per test resets persist's cached hydratePromise (configure()
// nulls it whenever the storage key changes).
let counter = 0
function freshKey() {
  return `persist-test-${counter++}`
}

describe("flushNow", () => {
  it("serializes the in-memory snapshot and clears the crash log", async () => {
    const key = freshKey()
    configure(key)
    const store = storageFor(key)

    M.createExercise({ name: "Flushed Lift", category: "back" })
    expect(store.pending.length).toBeGreaterThan(0) // recordPending appended

    await flushNow()
    expect(store.lastWritten).not.toBeNull()
    expect(store.pending.length).toBe(0) // clearPending ran

    const { snapshot } = await parse(store.lastWritten!)
    expect(snapshot.exercises.some((e) => e.name === "Flushed Lift")).toBe(true)
  })

  it("passes workout and logged-set counts with the write, skipping planned sets", async () => {
    const key = freshKey()
    configure(key)
    const snap = blankSnapshot()
    snap.exercises = [exercise(1, "Bench")]
    snap.workouts = [workout(1, "2026-09-20"), workout(2, "2026-09-21")]
    snap.workout_exercises = [we(1, 1, 1), we(2, 2, 1)]
    snap.sets = [
      set(1, 1, { weight: 100, reps: 5 }),
      set(2, 1, { weight: 100, reps: 5 }),
      set(3, 2, { weight: 105, reps: 5, is_planned: true }),
    ]
    loadSnapshot(snap)

    await flushNow()

    const stats = storageFor(key).lastStats!
    expect(stats.workouts).toBe(2)
    expect(stats.sets).toBe(2)
    expect(Number.isNaN(Date.parse(stats.savedAt))).toBe(false)
  })
})

describe("replaceSnapshotFromBytes", () => {
  it("clears the crash log before writing, so a kill between them cannot replay old edits onto the new data", async () => {
    const key = freshKey()
    const calls: string[] = []
    const base = memoryStorage()
    setStorageFactory(() => ({
      ...base,
      async writeSnapshot(b, st) {
        calls.push("write")
        return base.writeSnapshot(b, st)
      },
      async clearPending() {
        calls.push("clear")
        return base.clearPending()
      },
    }))
    configure(key)
    await replaceSnapshotFromBytes(await serialize(blankSnapshot()))
    expect(calls).toEqual(["clear", "write"])
  })

  it("passes the counts of the snapshot it writes", async () => {
    const key = freshKey()
    configure(key)
    const incoming = blankSnapshot()
    incoming.exercises = [exercise(1, "Squat")]
    incoming.workouts = [workout(1, "2026-09-19")]
    incoming.workout_exercises = [we(1, 1, 1)]
    incoming.sets = [set(1, 1, { weight: 140, reps: 3 })]

    await replaceSnapshotFromBytes(await serialize(incoming))

    expect(storageFor(key).lastStats).toMatchObject({ workouts: 1, sets: 1 })
  })

  it("a flush that starts while the replace is writing does not write the old snapshot after it", async () => {
    // The storage holds each write until released, the way a slow disk write
    // leaves the app free to run a flush timer or an AppState flushOnHide.
    const written: Uint8Array[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let queue: Promise<unknown> = Promise.resolve()
    const slow: BlobStorage = {
      async readSnapshot() {
        return written.at(-1) ?? null
      },
      writeSnapshot(bytes) {
        const next = queue.then(async () => {
          await gate
          written.push(bytes)
        })
        queue = next
        return next
      },
      async appendPending() {},
      async readPending() {
        return []
      },
      async clearPending() {},
    }
    const key = freshKey()
    setStorageFactory(() => slow)
    configure(key)

    const before = blankSnapshot()
    before.exercises = [exercise(1, "Before")]
    loadSnapshot(before)
    const after = blankSnapshot()
    after.exercises = [exercise(1, "After")]

    const replacing = replaceSnapshotFromBytes(await serialize(after))
    await Promise.resolve() // let the replace queue its write
    await new Promise((r) => setTimeout(r, 0))
    const flushing = flushNow()
    release()
    await Promise.all([replacing, flushing])

    const last = await parse(written.at(-1)!)
    expect(last.snapshot.exercises.map((e) => e.name)).toEqual(["After"])
    expect(currentSnapshot().exercises.map((e) => e.name)).toEqual(["After"])
  })
})

describe("hydrate: crash-log replay", () => {
  it("replays pending ops on top of the last persisted snapshot", async () => {
    const key = freshKey()
    const store = storageFor(key)

    // Last good snapshot has one custom exercise...
    const base = emptySnapshot("seed-device")
    base.exercises.push({
      id: 200,
      name: "Persisted Bench",
      category: "chest",
      kind: "weight_reps",
      is_custom: true,
    })
    await store.writeSnapshot(await serialize(base))

    // ...and an unflushed op log creating a workout.
    await store.appendPending(
      JSON.stringify({
        op: "create_workout",
        row: {
          id: 5000,
          date: "2026-09-09",
          status: "done",
          started_at: null,
          finished_at: null,
          gym: "",
          notes: "",
          created_at: "2026-09-09T08:00:00.000Z",
        },
      })
    )

    configure(key)
    await hydrate()

    const snap = currentSnapshot()
    expect(snap.exercises.some((e) => e.id === 200)).toBe(true) // from snapshot
    expect(snap.workouts.some((w) => w.id === 5000)).toBe(true) // from replay
  })

  it("replays a set_day_note op onto the last persisted snapshot", async () => {
    const key = freshKey()
    const store = storageFor(key)

    const base = emptySnapshot("seed-device")
    await store.writeSnapshot(await serialize(base))
    await store.appendPending(
      JSON.stringify({
        op: "set_day_note",
        date: "2026-08-16",
        text: "felt tired",
      })
    )

    configure(key)
    await hydrate()

    expect(currentSnapshot().day_notes).toEqual([
      { date: "2026-08-16", text: "felt tired" },
    ])
  })

  it("replays a set_exercise_note op onto the last persisted snapshot", async () => {
    const key = freshKey()
    const store = storageFor(key)

    const base = emptySnapshot("seed-device")
    base.workout_exercises = [
      { id: 7, workout_id: 1, exercise_id: 1, order: 0, note: "" },
    ]
    await store.writeSnapshot(await serialize(base))
    await store.appendPending(
      JSON.stringify({
        op: "set_exercise_note",
        weId: 7,
        text: "felt heavy",
      })
    )

    configure(key)
    await hydrate()

    expect(
      currentSnapshot().workout_exercises.find((we) => we.id === 7)?.note
    ).toBe("felt heavy")
  })

  it("replays a patch_workout note op onto the last persisted snapshot", async () => {
    const key = freshKey()
    const store = storageFor(key)

    const base: ReturnType<typeof emptySnapshot> = {
      ...emptySnapshot("seed-device"),
      workouts: [
        {
          id: 7,
          date: "2026-08-16",
          status: "done",
          started_at: null,
          finished_at: null,
          gym: "",
          notes: "",
          created_at: "2026-08-16T08:00:00.000Z",
        },
      ],
    }
    await store.writeSnapshot(await serialize(base))
    await store.appendPending(
      JSON.stringify({
        op: "patch_workout",
        id: 7,
        patch: { notes: "dropped to 3x5" },
      })
    )

    configure(key)
    await hydrate()

    expect(currentSnapshot().workouts[0].notes).toBe("dropped to 3x5")
  })

  it("replays a log_planned_set op with the time of the tap, not the time of the replay", async () => {
    const key = freshKey()
    configure(key)
    const snap = blankSnapshot()
    snap.exercises = [exercise(1, "Bench")]
    snap.workouts = [workout(1, "2026-09-21")]
    snap.workout_exercises = [we(1, 1, 1)]
    snap.sets = [set(5, 1, { weight: 100, reps: 5, is_planned: true })]
    const store = storageFor(key)
    await store.writeSnapshot(await serialize(snap))
    const at = "2026-09-21T10:00:00.000Z"
    store.pending.push(JSON.stringify({ op: "log_planned_set", setId: 5, patch: { reps: 5, created_at: at } }))

    await hydrate()
    const row = currentSnapshot().sets.find((s) => s.id === 5)!
    expect(row.is_planned).toBe(false)
    expect(row.created_at).toBe(at)
  })

  it("starts fresh (no throw) when storage is empty", async () => {
    const key = freshKey()
    configure(key)
    await hydrate()
    expect(currentSnapshot()).toBeTruthy()
  })

  // Set-level ops carry no PR flags: `add_set` records the row as it was
  // built (is_pr false, pre-recompute) and `delete_set` records only an id.
  // Replaying them raw used to leave the crown on the wrong row — a deleted
  // PR left no gold star anywhere, a new PR never got one — until something
  // else triggered a recompute. Replay must reproduce the live mutation.
  it("recomputes PR flags after replaying a delete_set", async () => {
    const key = freshKey()
    configure(key)
    const store = storageFor(key)

    const ex = M.createExercise({ name: "Replay Bench", category: "chest" })
    const w1 = M.createWorkout("2026-01-01").row
    const we1 = M.addExerciseToWorkout(w1.id, ex.id)
    const light = M.addSet(we1.id, { weight: 100, reps: 5 })
    const w2 = M.createWorkout("2026-01-08").row
    const we2 = M.addExerciseToWorkout(w2.id, ex.id)
    const heavy = M.addSet(we2.id, { weight: 110, reps: 5 })

    // Everything so far is safely on disk; the log is empty.
    await flushNow()
    expect(store.pending.length).toBe(0)

    // User deletes the PR set, then the app dies before the 30s flush.
    M.deleteSet(heavy.id)
    expect(store.pending.length).toBe(1)

    // Reboot: replay the log on top of the last good snapshot.
    resetStore()
    configure(key)
    await hydrate()

    const after = currentSnapshot().sets
    expect(after.length).toBe(1)
    expect(after[0].id).toBe(light.id)
    expect(after[0].is_pr).toBe(true) // crown moved back to the runner-up
    expect(after[0].is_position_pr).toBe(true)
  })

  it("recomputes PR flags after replaying an add_set", async () => {
    const key = freshKey()
    configure(key)

    const ex = M.createExercise({ name: "Replay Row", category: "back" })
    const w1 = M.createWorkout("2026-03-01").row
    const we1 = M.addExerciseToWorkout(w1.id, ex.id)
    const light = M.addSet(we1.id, { weight: 100, reps: 5 })
    await flushNow()

    const w2 = M.createWorkout("2026-03-08").row
    const we2 = M.addExerciseToWorkout(w2.id, ex.id)
    const heavy = M.addSet(we2.id, { weight: 120, reps: 5 })

    resetStore()
    configure(key)
    await hydrate()

    const byId = new Map(currentSnapshot().sets.map((s) => [s.id, s]))
    expect(byId.get(heavy.id)!.is_pr).toBe(true)
    expect(byId.get(heavy.id)!.was_pr).toBe(true)
    expect(byId.get(light.id)!.is_pr).toBe(false)
    expect(byId.get(light.id)!.was_pr).toBe(true) // sticky, as when logged
  })
})

describe("unload (sign-out)", () => {
  it("saves, then drops the data from memory; the next load reads it back from disk", async () => {
    const key = `users/${freshKey()}`
    configure(key)
    await hydrate()
    M.createExercise({ name: "Saved on sign-out", category: "chest" })

    await unload()
    expect(getState().hydrated).toBe(false)
    expect(currentSnapshot().exercises.some((e) => e.name === "Saved on sign-out")).toBe(false)

    // Same user signs in again: a real load, not the cached one.
    configure(key)
    await hydrate()
    expect(getState().hydrated).toBe(true)
    expect(currentSnapshot().exercises.some((e) => e.name === "Saved on sign-out")).toBe(true)
  })
})

describe("hydrate: damaged snapshot fallback", () => {
  const garbage = new TextEncoder().encode("not a gzip stream")
  // The damaged copies are logged on purpose; keep the run output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })


  function withCandidates(copies: (Uint8Array | null)[]) {
    const base = memoryStorage()
    const loaded: number[] = []
    const s: MemoryStorage & BlobStorage = Object.assign(base, {
      snapshotCandidates: () =>
        copies.map((c, i) => async () => {
          loaded.push(i)
          return c
        }),
    })
    return { s, loaded }
  }

  async function named(name: string) {
    const snap = emptySnapshot("d")
    snap.exercises = [exercise(1, name)]
    return serialize(snap)
  }

  it("loads the first copy that parses and writes it back as current", async () => {
    const { s, loaded } = withCandidates([garbage, await named("From .bak"), await named("From .bak2")])
    setStorageFactory(() => s)
    configure(freshKey())
    await hydrate()

    expect(currentSnapshot().exercises.map((e) => e.name)).toEqual(["From .bak"])
    expect(loaded).toEqual([0, 1]) // .bak2 never read
    const written = await parse(s.lastWritten!)
    expect(written.snapshot.exercises.map((e) => e.name)).toEqual(["From .bak"])
  })

  it("skips a missing newest copy the same way", async () => {
    const { s } = withCandidates([null, await named("From .bak")])
    setStorageFactory(() => s)
    configure(freshKey())
    await hydrate()
    expect(currentSnapshot().exercises.map((e) => e.name)).toEqual(["From .bak"])
  })

  it("does not rewrite when the newest copy loads", async () => {
    const { s, loaded } = withCandidates([await named("Current"), await named("Old")])
    setStorageFactory(() => s)
    configure(freshKey())
    await hydrate()
    expect(currentSnapshot().exercises.map((e) => e.name)).toEqual(["Current"])
    expect(loaded).toEqual([0])
    expect(s.lastWritten).toBeNull()
  })

  it("starts fresh, without overwriting anything, when no copy parses", async () => {
    const { s } = withCandidates([garbage, garbage])
    setStorageFactory(() => s)
    configure(freshKey())
    await hydrate()
    expect(currentSnapshot().workouts).toEqual([])
    expect(s.lastWritten).toBeNull()
  })
})

describe("runBatched", () => {
  it("suppresses per-op crash-log appends during a bulk operation", async () => {
    const key = freshKey()
    configure(key)
    const store = storageFor(key)

    await runBatched(async () => {
      M.createExercise({ name: "Bulk A", category: "back" })
      M.createExercise({ name: "Bulk B", category: "legs" })
      // No per-op appends while paused.
      expect(store.pending.length).toBe(0)
    })

    // Caller is responsible for the consolidating flush.
    await flushNow()
    const { snapshot } = await parse(store.lastWritten!)
    expect(snapshot.exercises.map((e) => e.name).sort()).toEqual(["Bulk A", "Bulk B"])
  })
})

describe("configure: user switch", () => {
  it("does not flush the outgoing user's snapshot into the incoming user's storage", async () => {
    vi.useFakeTimers()
    try {
      const keyA = `users/${freshKey()}`
      const keyB = `users/${freshKey()}`

      // User A hydrates, then makes a change — arming the 30s debounced flush.
      configure(keyA)
      await hydrate()
      M.createExercise({ name: "A-only exercise", category: "chest" })

      // Switching to user B repoints storage while A's timer is still armed.
      configure(keyB)

      // Let the debounce window elapse. A stale timer fires flushNow(), which
      // serializes whatever is in memory — still A's snapshot — into B's file.
      await vi.advanceTimersByTimeAsync(31_000)

      expect(storageFor(keyB).lastWritten).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("unloads the outgoing user's data until the incoming user's hydrate lands", async () => {
    const keyA = `users/${freshKey()}`
    const keyB = `users/${freshKey()}`
    configure(keyA)
    await hydrate()
    M.createExercise({ name: "A-only exercise", category: "chest" })
    expect(getState().hydrated).toBe(true)

    configure(keyB)

    // Not loaded: a flush (flushOnHide on an AppState change) must not write
    // A's rows into B's file, and auto sync skips an unhydrated store.
    expect(getState().hydrated).toBe(false)
    await flushNow()
    expect(storageFor(keyB).lastWritten).toBeNull()

    await hydrate()
    expect(getState().hydrated).toBe(true)
    expect(currentSnapshot().exercises.some((e) => e.name === "A-only exercise")).toBe(false)
  })

  it("a hydrate that finishes after a switch does not load the old user's data", async () => {
    const keyA = `users/${freshKey()}`
    const keyB = `users/${freshKey()}`
    const snapA = emptySnapshot("a")
    snapA.exercises = [exercise(1, "A only")]
    storageFor(keyA).writeSnapshot(await serialize(snapA))
    // A's read is slow; B signs in while it is still running.
    let releaseA: () => void = () => {}
    const aRead = new Promise<void>((r) => (releaseA = r))
    const slowA = storageFor(keyA)
    const read = slowA.readSnapshot.bind(slowA)
    slowA.readSnapshot = async () => {
      await aRead
      return read()
    }

    configure(keyA)
    const hydratingA = hydrate()
    configure(keyB)
    const hydratingB = hydrate()
    await hydratingB
    releaseA()
    await hydratingA

    expect(currentSnapshot().exercises.some((e) => e.name === "A only")).toBe(false)
    expect(storageFor(keyB).lastWritten && (await parse(storageFor(keyB).lastWritten!)).snapshot.exercises.some((e) => e.name === "A only")).toBeFalsy()
  })

  it("keeps the loaded data when the same user is configured again", async () => {
    const key = `users/${freshKey()}`
    configure(key)
    await hydrate()
    M.createExercise({ name: "Kept", category: "chest" })
    configure(key)
    expect(getState().hydrated).toBe(true)
    expect(currentSnapshot().exercises.some((e) => e.name === "Kept")).toBe(true)
  })
})
