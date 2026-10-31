import { getState } from "@lift/core/store/store"
import { parse, serialize } from "@lift/core/store/blob"
import { replaceSnapshotFromBytes, snapshotStats } from "@lift/core/store/persist"
import { recomputeAllPrs } from "@lift/core/store/mutations"
import { getActiveWebStorage } from "./storage"
import type { RestoreSlot } from "./storage/recovery"

let lastRestored: object | null = null

function active() {
  const storage = getActiveWebStorage()
  if (!storage || !getState().hydrated) throw new Error("No local store is open.")
  return storage
}

export async function saveRecoveryCopy() {
  const storage = active()
  const snapshot = getState().snapshot
  const bytes = await serialize(snapshot)
  if (active() !== storage) throw new Error("The account changed. Please try again.")
  await storage.saveUndo(bytes, snapshotStats(snapshot))
}

export async function listRestorePoints() { return active().list() }

export async function restoreFromSlot(slot: RestoreSlot) {
  const storage = active()
  const bytes = await storage.readSlot(slot)
  if (!bytes) throw new Error("That restore point no longer exists.")
  const { migrated } = await parse(bytes)
  if (active() !== storage) throw new Error("The account changed. Please try again.")
  // Keep the original undo across repeated restores, including Undo itself.
  await storage.restoring(() => replaceSnapshotFromBytes(bytes), getState().snapshot === lastRestored)
  if (active() !== storage) throw new Error("The account changed. Please try again.")
  if (migrated) recomputeAllPrs()
  lastRestored = getState().snapshot
}
