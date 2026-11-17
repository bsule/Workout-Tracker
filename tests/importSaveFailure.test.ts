import { afterEach, describe, expect, it } from "vitest"
import { FITNOTES_HEADERS, ImportNotSavedError, importFitnotesCsv, importSnapshotJson } from "@lift/core/import"
import { configure, setStorageFactory } from "@lift/core/store/persist"
import { markUnhydrated } from "@lift/core/store/store"
import { emptySnapshot } from "@lift/core/store/schema"
import { currentSnapshot, loadSnapshot, memoryStorage } from "./helpers/store"

// Bulk imports skip the crash log and then wait for the save. When that save
// fails, the import is already in memory and the store keeps retrying, so the
// import must not report a plain failure (the user would import it again).

let n = 0
/** A fresh account whose snapshot writes fail. `onWrite` runs first. */
function failingStore(onWrite: () => void = () => {}) {
  const store = memoryStorage()
  store.writeSnapshot = async () => {
    onWrite()
    throw new Error("disk full")
  }
  setStorageFactory(() => store)
  configure(`failing-${++n}`)
  loadSnapshot(emptySnapshot("test-device"))
}

afterEach(() => {
  // Leave a working store behind so the scheduled retry stops failing.
  setStorageFactory(() => memoryStorage())
  configure(`ok-${++n}`)
  loadSnapshot(emptySnapshot("test-device"))
})

const csv = [FITNOTES_HEADERS.join(","), "2026-01-01,Zercher Squat,Legs,100,,5,,,,,wr"].join("\n")

describe("an import whose save fails", () => {
  it("reports applied-but-unsaved for a CSV import, with the result", async () => {
    failingStore()
    const err = await importFitnotesCsv(csv, { mode: "merge" }).catch((e) => e)
    expect(err).toBeInstanceOf(ImportNotSavedError)
    expect((err as ImportNotSavedError).result.imported).toBe(1)
    expect(String((err as ImportNotSavedError).saveError)).toContain("disk full")
    // The data is live in memory.
    expect(currentSnapshot().sets).toHaveLength(1)
  })

  it("reports applied-but-unsaved for a JSON import", async () => {
    failingStore()
    const text = JSON.stringify({
      version: 2,
      custom_exercises: [],
      workouts: [{ date: "2026-01-01", exercises: [{ exercise: { name: "Zercher Squat" }, sets: [{ weight_kg: 100, reps: 5 }] }] }],
    })
    const err = await importSnapshotJson(text, { mode: "merge" }).catch((e) => e)
    expect(err).toBeInstanceOf(ImportNotSavedError)
    expect((err as ImportNotSavedError).result.imported).toBe(1)
  })

  it("is a plain failure when the store closed meanwhile, since the data went with it", async () => {
    failingStore(() => markUnhydrated())
    const err = await importFitnotesCsv(csv, { mode: "merge" }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ImportNotSavedError)
    expect((err as Error).message).toBe("disk full")
  })

  it("a save that works resolves with the result", async () => {
    setStorageFactory(() => memoryStorage())
    configure(`ok-${++n}`)
    loadSnapshot(emptySnapshot("test-device"))
    const result = await importFitnotesCsv(csv, { mode: "merge" })
    expect(result.imported).toBe(1)
  })
})
