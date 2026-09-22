import {
  replaceSnapshotFromBytes,
  snapshotStats,
} from "@lift/core/store/persist"
import { getState } from "@lift/core/store/store"
import { serialize, parse } from "@lift/core/store/blob"
import { recomputeAllPrs } from "@lift/core/store/mutations"
import { getActiveStorage, type RestoreMeta, type Slot } from "./storage"

export type RestorableSlot = Exclude<Slot, "current">

// The snapshot the last restore loaded. While it is still the one in memory,
// nothing was changed since, and the undo slot already holds the data from
// before that restore; overwriting it would lose that data for good.
let lastRestored: object | null = null

export async function listRestorePoints(): Promise<RestoreMeta> {
  const storage = getActiveStorage()
  return storage ? storage.listRestorePoints() : {}
}

/**
 * Replaces the local data with one restore point. The data it replaces goes
 * to the undo slot first, taken from memory, so edits that are still only in
 * the crash log are kept too.
 *
 * The daily slot is held for the write: without that, restoring yesterday's
 * copy would push a minutes-old file into .bak2 and throw yesterday away.
 */
export async function restoreFromSlot(slot: RestorableSlot): Promise<void> {
  const storage = getActiveStorage()
  if (!storage) throw new Error("No local store is open.")
  const bytes = await storage.readSlot(slot)
  if (!bytes) throw new Error("That restore point no longer exists.")
  // Parse before anything is written, so a damaged file changes nothing.
  const { migrated } = await parse(bytes)

  const { snapshot } = getState()
  if (snapshot !== lastRestored) {
    await storage.writeUndo(await serialize(snapshot), snapshotStats(snapshot))
  }
  await storage.withDailySlotHeld(() => replaceSnapshotFromBytes(bytes))
  // A copy from an older schema carries stale PR flags; hydrate would
  // recompute them, but this path does not go through hydrate.
  if (migrated) recomputeAllPrs()
  lastRestored = getState().snapshot
}
