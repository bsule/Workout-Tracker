/**
 * Top-weight records derived from an exercise's history.
 *
 * Pure functions over `ExerciseHistoryDay[]`. They read no store state, so
 * both clients and the test suite can call them directly. This lives apart
 * from queries.ts for that reason: queries.ts reaches into `getState()`.
 */

import type { ExerciseHistoryDay } from "../types"
import { weightKey } from "../units"

export interface TopRepRecord {
  reps: number
  weightKg: number
  date: string
}

interface Candidate {
  reps: number
  weightKg: number
  date: string
}

/**
 * Best weight at each rep count, heaviest first. One row per rep count, so a
 * 5-rep best and an 8-rep best both survive; ties go to the harder set.
 *
 * Weights compare through `weightKey`, never as raw kg floats: an imported
 * 125 lb set holds 56.70 kg and a typed one 56.699, so a raw compare lets that
 * noise pick the winner and, in the sort, jump ahead of the reps tiebreak.
 */
function reduceToRecords(pool: Candidate[], limit: number): TopRepRecord[] {
  const best = new Map<number, { weightKg: number; date: string }>()
  for (const c of pool) {
    const cur = best.get(c.reps)
    if (!cur || weightKey(c.weightKg) > weightKey(cur.weightKg)) {
      best.set(c.reps, { weightKg: c.weightKg, date: c.date })
    }
  }
  return [...best.entries()]
    .map(([reps, v]) => ({ reps, weightKg: v.weightKg, date: v.date }))
    .sort(
      (a, b) => weightKey(b.weightKg) - weightKey(a.weightKg) || b.reps - a.reps
    )
    .slice(0, limit)
}

function* candidatesOf(
  days: ExerciseHistoryDay[],
  position?: number
): Generator<Candidate> {
  for (const day of days) {
    for (const s of day.sets) {
      if (s.weight == null || s.reps == null) continue
      // position 0 means the set takes no position at all, so a caller asking
      // for a real position must never match it.
      if (position != null && s.position !== position) continue
      yield { reps: s.reps, weightKg: s.weight, date: day.date }
    }
  }
}

/**
 * @param position when given, only sets at that 1-based set position count.
 *   Position has the same meaning as in prs.ts, so "best 2nd set" here and the
 *   "2PR" badge on a set row always agree. Omit it for records across every
 *   set of the exercise.
 */
export function topRepRecords(
  days: ExerciseHistoryDay[],
  limit: number,
  opts: { position?: number } = {}
): TopRepRecord[] {
  return reduceToRecords([...candidatesOf(days, opts.position)], limit)
}

/**
 * Every position's records in one pass over the history.
 *
 * The set logger swaps the position it displays after each logged set. Calling
 * `topRepRecords` per swap would rescan the whole history each time; this
 * builds the whole map once per history change instead, and the swap becomes a
 * map lookup.
 */
export function topRepRecordsByPosition(
  days: ExerciseHistoryDay[],
  limit: number
): Map<number, TopRepRecord[]> {
  const buckets = new Map<number, Candidate[]>()
  for (const day of days) {
    for (const s of day.sets) {
      if (s.weight == null || s.reps == null) continue
      if (s.position <= 0) continue
      const arr = buckets.get(s.position) ?? []
      arr.push({ reps: s.reps, weightKg: s.weight, date: day.date })
      buckets.set(s.position, arr)
    }
  }
  const out = new Map<number, TopRepRecord[]>()
  for (const [position, pool] of buckets) {
    out.set(position, reduceToRecords(pool, limit))
  }
  return out
}
