import { beforeEach, describe, expect, it } from "vitest"
import { buildJson } from "@lift/core/export"
import { importSnapshotJson } from "@lift/core/import"
import { configure, hydrate, setStorageFactory } from "@lift/core/store/persist"
import { dedupeGyms } from "@lift/core/store/repair"
import { parse, serialize } from "@lift/core/store/blob"
import * as M from "@lift/core/store/mutations"
import { currentSnapshot, installMemoryStorage, memoryStorage, resetStore } from "./helpers/store"
import { blankSnapshot } from "./helpers/build"

// A Replace import kept the saved gyms and then added the file's gyms again,
// so every gym showed twice in the pickers (and React warned about duplicate
// keys). The import no longer does that, and a load repairs data it left.

const gymNames = () => currentSnapshot().gyms.map((g) => g.name)

describe("Replace import and saved gyms", () => {
  beforeEach(() => {
    resetStore()
    installMemoryStorage()
  })

  it("does not add a gym again when the same file is imported twice with Replace", async () => {
    M.createGym("Downtown Gym")
    M.createGym("Home Gym")
    const json = buildJson(currentSnapshot())
    await importSnapshotJson(json, { mode: "replace" })
    await importSnapshotJson(json, { mode: "replace" })
    expect(gymNames()).toEqual(["Downtown Gym", "Home Gym"])
  })

  it("matches the file's gyms ignoring case, like merge does", async () => {
    M.createGym("Downtown Gym")
    const json = buildJson(currentSnapshot())
    M.renameGym(currentSnapshot().gyms[0].id, "downtown gym")
    await importSnapshotJson(json, { mode: "replace" })
    expect(gymNames()).toEqual(["downtown gym"])
  })

  it("still adds a gym the store does not have", async () => {
    M.createGym("Downtown Gym")
    const json = buildJson(currentSnapshot())
    resetStore()
    await importSnapshotJson(json, { mode: "replace" })
    expect(gymNames()).toEqual(["Downtown Gym"])
  })
})

describe("dedupeGyms", () => {
  it("keeps the first row of each exact name and leaves case variants alone", () => {
    const snap = blankSnapshot()
    snap.gyms = [
      { id: 1, name: "Downtown Gym" },
      { id: 2, name: "Home Gym" },
      { id: 3, name: "Downtown Gym" },
      { id: 4, name: "home gym" },
    ]
    expect(dedupeGyms(snap).gyms.map((g) => g.id)).toEqual([1, 2, 4])
  })

  it("returns the same snapshot when nothing repeats", () => {
    const snap = blankSnapshot()
    snap.gyms = [{ id: 1, name: "A" }]
    expect(dedupeGyms(snap)).toBe(snap)
  })

  it("repairs a stored snapshot on load and saves the fix", async () => {
    const snap = blankSnapshot()
    snap.gyms = [
      { id: 15124, name: "Downtown Gym" },
      { id: 15125, name: "Home Gym" },
      { id: 15812, name: "Downtown Gym" },
      { id: 15813, name: "Home Gym" },
    ]
    const storage = memoryStorage()
    await storage.writeSnapshot(await serialize(snap))
    storage.lastWritten = null
    setStorageFactory(() => storage)
    configure(`accounts/dup-${Math.random()}`)
    await hydrate()

    expect(gymNames()).toEqual(["Downtown Gym", "Home Gym"])
    expect(storage.lastWritten).not.toBeNull()
    const saved = await parse(storage.lastWritten!)
    expect(saved.snapshot.gyms.map((g) => g.id)).toEqual([15124, 15125])
  })
})
