import { describe, it, expect, beforeEach } from "vitest"
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
import { currentSnapshot, memoryStorage, type MemoryStorage } from "./helpers/store"

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

  it("starts fresh (no throw) when storage is empty", async () => {
    const key = freshKey()
    configure(key)
    await hydrate()
    expect(currentSnapshot()).toBeTruthy()
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
