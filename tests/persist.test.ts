import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  setStorageFactory,
  configure,
  hydrate,
  flushNow,
  runBatched,
} from "@lift/core/store/persist"
import { serialize, parse } from "@lift/core/store/blob"
import { emptySnapshot } from "@lift/core/store/schema"
import * as M from "@lift/core/store/mutations"
import {
  currentSnapshot,
  memoryStorage,
  resetStore,
  type MemoryStorage,
} from "./helpers/store"

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
})
