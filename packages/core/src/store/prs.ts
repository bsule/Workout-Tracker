/**
 * PR (personal record) computation.
 *
 * Pure snapshot -> snapshot functions, deliberately kept out of mutations.ts
 * so that persist.ts can reuse them when replaying the crash log without
 * creating a persist <-> mutations import cycle. Every code path that changes
 * a set (live mutation, crash-log replay, import, migration) must run these,
 * or the is_pr / is_position_pr flags stored on the rows go stale.
 */

import type { SetRow, Snapshot } from "./schema"
import type { Indexes } from "./indexes"
import { weightKey } from "../units"

type Effort = { weight: number; reps: number }

/**
 * The record rule. `o` beats `s` when it is heavier with at least as many
 * reps, or the same weight with more reps. Weights compare through weightKey,
 * never as raw floats: an imported set and a typed one can hold kg values that
 * differ in the third decimal while displaying the same number (see units.ts).
 * On raw floats that noise broke both branches: the equal-weight branch never
 * fired, so an older 135x7 failed to dominate a newer 135x5.
 */
export function dominatesEffort(o: Effort, s: Effort): boolean {
  const ow = weightKey(o.weight)
  const sw = weightKey(s.weight)
  return (ow > sw && o.reps >= s.reps) || (ow === sw && o.reps > s.reps)
}

/** Same weight (by weightKey) and reps. The earlier of two such sets holds
 *  the record. */
export function sameEffort(o: Effort, s: Effort): boolean {
  return weightKey(o.weight) === weightKey(s.weight) && o.reps === s.reps
}

/**
 * Whether a set of (`weight`, `reps`) about to be added to `weId` would be the
 * current overall PR / position PR for `exerciseId`, and the position it
 * lands at. It applies the same rules recomputePrsForExercise does, with the
 * new set taken as the latest: any logged set that beats it or ties it rules
 * it out, overall and at its position. The mobile set logger calls it at tap
 * time so its placeholder row shows the right star before the (deferred)
 * mutation and the real recompute land. `queued` holds sets already tapped
 * into `weId` whose mutation has not landed yet (a fast second tap on Save):
 * they count as logged sets after the existing ones, oldest first.
 */
export function predictPrFlags(
  indexes: Pick<Indexes, "workoutExercisesByExercise" | "setsByWorkoutExercise">,
  exerciseId: number,
  weId: number,
  weight: number,
  reps: number,
  queued: readonly Effort[] = []
): { isPr: boolean; isPosPr: boolean; position: number } {
  const wes = indexes.workoutExercisesByExercise.get(exerciseId) ?? []
  let isPr = true
  const targetSets = indexes.setsByWorkoutExercise.get(weId) ?? []
  let loggedInTarget = 0
  for (const s of targetSets) {
    if (s.is_planned) continue
    if (s.weight == null || s.reps == null) continue
    loggedInTarget++
  }
  const position = loggedInTarget + queued.length + 1
  let isPosPr = true
  const next: Effort = { weight, reps }
  // Queued sets sit at earlier positions, so they only bear on the overall PR.
  for (const prior of queued) {
    if (dominatesEffort(prior, next) || sameEffort(prior, next)) isPr = false
  }
  for (const we of wes) {
    const arr = (indexes.setsByWorkoutExercise.get(we.id) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id - b.id)
    let posIdx = 0
    for (const s of arr) {
      if (s.is_planned) continue
      if (s.weight == null || s.reps == null) continue
      posIdx++
      const prior: Effort = { weight: s.weight, reps: s.reps }
      if (dominatesEffort(prior, next) || sameEffort(prior, next)) {
        isPr = false
        if (posIdx === position) isPosPr = false
      }
      if (!isPr && !isPosPr) return { isPr, isPosPr, position }
    }
  }
  return { isPr, isPosPr, position }
}

export function recomputePrsForWe(snap: Snapshot, weId: number): Snapshot {
  const we = snap.workout_exercises.find((x) => x.id === weId)
  if (!we) return snap
  return recomputePrsForExercise(snap, we.exercise_id)
}

/**
 * Same pass over several exercises — for mutations that touch a whole day
 * (deleting a workout, copying one forward) and so can disturb the records of
 * more than one exercise at a time. Duplicate ids are collapsed.
 */
export function recomputePrsForExercises(
  snap: Snapshot,
  exerciseIds: Iterable<number>
): Snapshot {
  let next = snap
  for (const exerciseId of new Set(exerciseIds)) {
    next = recomputePrsForExercise(next, exerciseId)
  }
  return next
}

export function recomputePrsForExercise(snap: Snapshot, exerciseId: number): Snapshot {
  // PR logic only applies to weight×reps exercises. Cardio / time-only sets
  // are skipped — their is_pr stays false.
  const ex = snap.exercises.find((e) => e.id === exerciseId)
  if (ex && ex.kind !== "weight_reps") return snap

  const weIds = new Set(
    snap.workout_exercises
      .filter((we) => we.exercise_id === exerciseId)
      .map((we) => we.id)
  )
  // A set is PR iff no *other* set dominates it — past or future. Once a
  // later set beats it the gold star moves, and the dethroned set renders as
  // the muted "historical PR" star: was_pr, which holds when no *earlier* set
  // matched or beat it. Both are derived from the rows on every pass, never
  // carried over, so an edit, a delete or a set logged on a past day moves
  // them the same way an import would.
  const workoutsById = new Map(snap.workouts.map((w) => [w.id, w]))
  const exercisesById = new Map(snap.workout_exercises.map((we) => [we.id, we]))
  const weToDate = new Map<number, string>()
  for (const we of snap.workout_exercises) {
    if (!weIds.has(we.id)) continue
    const w = workoutsById.get(we.workout_id)
    if (w) weToDate.set(we.id, w.date)
  }
  const candidates = snap.sets.filter(
    (s) =>
      weIds.has(s.workout_exercise_id) &&
      !s.is_planned &&
      s.weight != null &&
      s.reps != null
  ) as Array<SetRow & { weight: number; reps: number }>
  const dateOf = (s: SetRow) => weToDate.get(s.workout_exercise_id) ?? ""
  const weOrderOf = (s: SetRow) =>
    exercisesById.get(s.workout_exercise_id)?.order ?? 0
  const ts = (s: SetRow) => Date.parse(s.created_at) || 0
  const isPriorTo = (o: SetRow, s: SetRow) => {
    const od = dateOf(o)
    const sd = dateOf(s)
    if (od !== sd) return od < sd
    const ow = weOrderOf(o)
    const sw = weOrderOf(s)
    if (ow !== sw) return ow < sw
    if (o.order !== s.order) return o.order < s.order
    const ot = ts(o)
    const st = ts(s)
    if (ot !== st) return ot < st
    return o.id < s.id
  }
  // Both passes below restate dominatesEffort / sameEffort above on weightKey
  // (at least as heavy with at least as many reps). predictPrFlags calls those
  // two directly, so the set logger's preview and the saved flag agree.

  type Cand = SetRow & { weight: number; reps: number }
  const computePrSets = (
    pool: Cand[]
  ): { current: Set<number>; historical: Set<number> } => {
    const current = new Set<number>()
    // Heaviest first, then most reps, with the earliest exact tie first.
    // Every preceding row can dominate this row iff it has at least as
    // many reps. One running maximum replaces the all-pairs comparison.
    const orderedByEffort = pool.slice().sort((a, b) =>
      weightKey(b.weight) - weightKey(a.weight) ||
      b.reps - a.reps ||
      (isPriorTo(a, b) ? -1 : isPriorTo(b, a) ? 1 : 0)
    )
    let maxReps = -Infinity
    for (const s of orderedByEffort) {
      if (s.reps > maxReps) current.add(s.id)
      maxReps = Math.max(maxReps, s.reps)
    }
    // An earlier set rules a set out when it dominates it or ties it, which
    // together is: at least as heavy with at least as many reps. Walk in date
    // order and keep only the earlier efforts no other earlier one covers.
    // That frontier holds at most one entry per rep count, so this runs on
    // every save without comparing each set against its whole history.
    const historical = new Set<number>()
    const ordered = pool
      .slice()
      .sort((a, b) => (isPriorTo(a, b) ? -1 : isPriorTo(b, a) ? 1 : 0))
    let frontier: { w: number; reps: number }[] = []
    for (const s of ordered) {
      const w = weightKey(s.weight)
      if (frontier.some((f) => f.w >= w && f.reps >= s.reps)) continue
      historical.add(s.id)
      frontier = frontier.filter((f) => !(w >= f.w && s.reps >= f.reps))
      frontier.push({ w, reps: s.reps })
    }
    return { current, historical }
  }

  const overall = computePrSets(candidates)

  // Position = index (1-based) in the order-sorted set list within each
  // workout_exercise. Group by position across all workout_exercises and
  // run the same PR pass per bucket so e.g. the heaviest-ever 2nd set is
  // marked even when a different workout's 1st set is heavier.
  const positionOf = new Map<number, number>()
  const byWe = new Map<number, Cand[]>()
  for (const c of candidates) {
    const arr = byWe.get(c.workout_exercise_id) ?? []
    arr.push(c)
    byWe.set(c.workout_exercise_id, arr)
  }
  for (const arr of byWe.values()) {
    arr.sort((a, b) => a.order - b.order || a.id - b.id)
    arr.forEach((c, i) => positionOf.set(c.id, i + 1))
  }
  const buckets = new Map<number, Cand[]>()
  for (const c of candidates) {
    const p = positionOf.get(c.id)!
    const arr = buckets.get(p) ?? []
    arr.push(c)
    buckets.set(p, arr)
  }
  const posCurrent = new Set<number>()
  const posHistorical = new Set<number>()
  for (const pool of buckets.values()) {
    const r = computePrSets(pool)
    r.current.forEach((id) => posCurrent.add(id))
    r.historical.forEach((id) => posHistorical.add(id))
  }

  const sets = snap.sets.map((s) => {
    if (!weIds.has(s.workout_exercise_id)) return s
    if (s.is_planned || s.weight == null || s.reps == null) {
      if (!s.is_pr && !s.is_position_pr && !s.was_pr && !s.was_position_pr) {
        return s
      }
      return {
        ...s,
        is_pr: false,
        was_pr: false,
        is_position_pr: false,
        was_position_pr: false,
      }
    }
    const isPr = overall.current.has(s.id)
    const wasPr = overall.historical.has(s.id)
    const isPosPr = posCurrent.has(s.id)
    const wasPosPr = posHistorical.has(s.id)
    if (
      s.is_pr === isPr &&
      s.was_pr === wasPr &&
      s.is_position_pr === isPosPr &&
      s.was_position_pr === wasPosPr
    ) {
      return s
    }
    return {
      ...s,
      is_pr: isPr,
      was_pr: wasPr,
      is_position_pr: isPosPr,
      was_position_pr: wasPosPr,
    }
  })
  return { ...snap, sets }
}
