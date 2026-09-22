import type { SnapshotStats } from "@lift/core/store/storage"

/**
 * Local restore points, beside the live snapshot in the app sandbox:
 *
 *   snapshot.bin       current data, rewritten on every flush
 *   snapshot.bin.bak   the flush before the current one
 *   snapshot.bin.bak2  the daily point: .bak moves in only once it is 24h old
 *   snapshot.bin.undo  the data a restore replaced
 *
 * A .bak2 that rotated on every flush would be a minute old after two more
 * saves, too young to catch a mistake the user notices later. Holding it for
 * a day is what makes it a way back.
 *
 * Pure so the suite can test it without expo-file-system.
 */

export type Slot = "current" | "bak" | "bak2" | "undo"

/** Counts are null for a file written before the app kept them. */
export interface SlotInfo {
  savedAt: string
  workouts: number | null
  sets: number | null
}

export type RestoreMeta = Partial<Record<Slot, SlotInfo>>

export const DAILY_SLOT_MS = 24 * 60 * 60 * 1000

export interface RotationPlan {
  /** Move .bak into .bak2 before .bak takes the outgoing current file. */
  promote: boolean
  meta: RestoreMeta
}

/**
 * `exists` says which files are on disk now. `meta` must already hold an
 * entry for each of them (the adapter falls back to file mtimes).
 */
export function planRotation(
  meta: RestoreMeta,
  exists: { current: boolean; bak: boolean; bak2: boolean },
  incoming: SnapshotStats | undefined,
  now: Date,
  opts: { holdDaily?: boolean } = {}
): RotationPlan {
  const promote =
    !opts.holdDaily &&
    exists.current &&
    exists.bak &&
    (!exists.bak2 || isOlderThanDay(meta.bak2?.savedAt, now))

  const next: RestoreMeta = { ...meta }
  if (promote) next.bak2 = meta.bak
  if (exists.current) next.bak = meta.current
  next.current = incoming ?? {
    savedAt: now.toISOString(),
    workouts: null,
    sets: null,
  }
  return { promote, meta: next }
}

function isOlderThanDay(savedAt: string | undefined, now: Date): boolean {
  if (!savedAt) return true
  const t = Date.parse(savedAt)
  if (Number.isNaN(t)) return true
  return now.getTime() - t >= DAILY_SLOT_MS
}

/**
 * How far a file's mtime may trail the savedAt recorded for it. The stats are
 * taken just before the write, and the write of a large snapshot takes a
 * second or two. Moves keep the mtime, so a rotated file still matches.
 */
export const META_MTIME_TOLERANCE_MS = 15_000

const SLOTS: Slot[] = ["current", "bak", "bak2", "undo"]

/**
 * One entry per file on disk. The rotation writes restore-points.json after
 * its moves, so a kill between them leaves entries that describe the file
 * that used to sit in a slot. An entry whose savedAt does not match the
 * file's mtime is dropped for the mtime and unknown counts: a label that
 * says "2 days ago" on a minutes-old copy would send the user to the wrong
 * restore point.
 *
 * `mtimes` holds each existing file's modification time in ms.
 */
export function reconcileMeta(
  stored: RestoreMeta,
  mtimes: Partial<Record<Slot, number>>
): RestoreMeta {
  const out: RestoreMeta = {}
  for (const slot of SLOTS) {
    const mtime = mtimes[slot]
    if (mtime == null) continue
    const entry = stored[slot]
    const t = entry ? Date.parse(entry.savedAt) : NaN
    out[slot] =
      entry && Math.abs(mtime - t) <= META_MTIME_TOLERANCE_MS
        ? entry
        : { savedAt: new Date(mtime).toISOString(), workouts: null, sets: null }
  }
  return out
}
