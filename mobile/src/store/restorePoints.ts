/**
 * Local restore points, kept by the engine next to the account's data:
 * `current` (the last save), `bak` (the save before it), `bak2` (moved
 * forward only once it is a day old) and `undo` (the data the last restore or
 * cloud pull replaced; a second restore with no edits in between keeps it).
 *
 * A save is a restore point capture. Like the old 30 second snapshot flush,
 * one lands 30 seconds after the last edit and whenever the app leaves the
 * foreground, so `bak` stays "your data before the most recent save".
 */
import type { AccountEngineSession } from "@lift/engine-client/session"
import { mobileSessions, onEngineCommit } from "../engine/mobileEngine"

export type RestorableSlot = "bak" | "bak2" | "undo"
export type Slot = "current" | RestorableSlot

/** Counts are null for a copy saved before the app kept them. */
export interface SlotInfo {
  savedAt: string
  workouts: number | null
  sets: number | null
}

export type RestoreMeta = Partial<Record<Slot, SlotInfo>>

const SAVE_DEBOUNCE_MS = 30_000
let timer: ReturnType<typeof setTimeout> | null = null
let pendingFor: AccountEngineSession | null = null
const listeners = new Set<() => void>()

/** Called after each new restore point, so an open list can refresh. */
export function addRestorePointListener(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

onEngineCommit(() => {
  const session = mobileSessions.session
  if (!session) return
  if (timer) clearTimeout(timer)
  pendingFor = session
  timer = setTimeout(() => {
    timer = null
    void saveRestorePointNow().catch((e) => {
      console.warn("[restorePoints]", e instanceof Error ? e.message : e)
    })
  }, SAVE_DEBOUNCE_MS)
})

export function cancelRestorePoint() {
  if (timer) clearTimeout(timer)
  timer = null
  pendingFor = null
}

/** Capture now if edits are waiting for a save; a no-op otherwise. */
export async function saveRestorePointNow(): Promise<void> {
  const session = pendingFor
  if (timer) clearTimeout(timer)
  timer = null
  pendingFor = null
  // Edits of an account that has since closed belong to its own last save.
  if (!session?.data || mobileSessions.session !== session) return
  await session.data.saveRestorePoint()
  for (const listener of listeners) listener()
}

function requireSession(): AccountEngineSession & { data: NonNullable<AccountEngineSession["data"]> } {
  const session = mobileSessions.session
  if (!session?.data) throw new Error("No local store is open.")
  return session as AccountEngineSession & { data: NonNullable<AccountEngineSession["data"]> }
}

function toInfo(raw: unknown): SlotInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.savedAt !== "string") return undefined
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null)
  return { savedAt: value.savedAt, workouts: count(value.workouts), sets: count(value.sets) }
}

export async function listRestorePoints(): Promise<RestoreMeta> {
  const raw = await requireSession().data.restorePoints()
  const meta: RestoreMeta = {}
  for (const slot of ["current", "bak", "bak2", "undo"] as const) {
    const info = toInfo(raw[slot])
    if (info) meta[slot] = info
  }
  return meta
}

/**
 * Replaces the local data with one restore point. The engine keeps the data
 * it replaces in the undo slot, and refuses the restore if the account
 * changed or more edits landed after this version was read.
 */
export async function restoreFromSlot(slot: RestorableSlot): Promise<void> {
  const session = requireSession()
  // Edits waiting for a save belong to the data being replaced, which the
  // undo slot holds; do not capture them afterwards over the restored data.
  cancelRestorePoint()
  const { generation, revision } = await session.data.currentVersion()
  if (mobileSessions.session !== session) {
    throw new Error("The account changed during restore. Please try again.")
  }
  await session.data.restore(slot, generation, revision)
}
