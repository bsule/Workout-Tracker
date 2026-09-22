/**
 * Mobile sign-out (mobile/src/store/bootstrap.ts): the rest timer ends, and
 * the store is saved and dropped from memory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => [] as string[])

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  InteractionManager: { runAfterInteractions: () => {} },
}))
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///docs/" }))
vi.mock("../mobile/src/restTimer", () => ({
  restTimer: {
    disable: () => calls.push("timer ended"),
    reconcile: () => {},
  },
}))

import { configure, flushNow, hydrate, setStorageFactory } from "@lift/core/store/persist"
import * as M from "@lift/core/store/mutations"
import { getState } from "@lift/core/store/store"
import { parse } from "@lift/core/store/blob"
import { unloadForSignOut } from "../mobile/src/store/bootstrap"
import { memoryStorage, resetStore } from "./helpers/store"

beforeEach(() => {
  calls.length = 0
  resetStore()
})

describe("unloadForSignOut", () => {
  it("ends the rest timer, saves the data, and drops it from memory", async () => {
    const storage = memoryStorage()
    setStorageFactory(() => storage)
    configure(`users/sign-out-${Math.random()}`)
    await hydrate()
    M.createExercise({ name: "Logged before sign-out", category: "chest" })

    await unloadForSignOut()

    expect(calls).toEqual(["timer ended"])
    expect(getState().hydrated).toBe(false)
    const saved = await parse(storage.lastWritten!)
    expect(saved.snapshot.exercises.some((e) => e.name === "Logged before sign-out")).toBe(true)
    // Nothing left in memory for a flush to write anywhere.
    storage.lastWritten = null
    await flushNow()
    expect(storage.lastWritten).toBeNull()
  })

  it("is safe with no store loaded (a signed-out cold start)", async () => {
    await expect(unloadForSignOut()).resolves.toBeUndefined()
    expect(calls).toEqual(["timer ended"])
  })
})
