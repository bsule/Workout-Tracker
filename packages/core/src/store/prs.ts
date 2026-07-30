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

export function recomputePrsForExercise(
  snap: Snapshot,
  exerciseId: number,
  opts: { deriveHistorical?: boolean } = {}
): Snapshot {
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
  // later set beats it the gold star moves; the dethroned set keeps was_pr
  // (sticky) and renders as the muted "historical PR" star.
  const weToDate = new Map<number, string>()
  for (const we of snap.workout_exercises) {
    if (!weIds.has(we.id)) continue
    const w = snap.workouts.find((w) => w.id === we.workout_id)
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
    snap.workout_exercises.find((we) => we.id === s.workout_exercise_id)
      ?.order ?? 0
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
  const dominates = (
    o: SetRow & { weight: number; reps: number },
    s: SetRow & { weight: number; reps: number }
  ) =>
    (o.weight > s.weight && o.reps >= s.reps) ||
    (o.weight === s.weight && o.reps > s.reps)

  type Cand = SetRow & { weight: number; reps: number }
  const computePrSets = (
    pool: Cand[]
  ): { current: Set<number>; historical: Set<number> } => {
    const current = new Set<number>()
    for (const s of pool) {
      let dominated = false
      for (const o of pool) {
        if (o.id === s.id) continue
        if (dominates(o, s)) {
          dominated = true
          break
        }
        // Exact tie — earliest wins.
        if (o.weight === s.weight && o.reps === s.reps && isPriorTo(o, s)) {
          dominated = true
          break
        }
      }
      if (!dominated) current.add(s.id)
    }
    const historical = new Set<number>()
    if (opts.deriveHistorical) {
      const ordered = pool
        .slice()
        .sort((a, b) => (isPriorTo(a, b) ? -1 : isPriorTo(b, a) ? 1 : 0))
      const prior: Cand[] = []
      for (const s of ordered) {
        const hadPriorRecord = prior.some(
          (o) =>
            dominates(o, s) ||
            (o.weight === s.weight && o.reps === s.reps && isPriorTo(o, s))
        )
        if (!hadPriorRecord) historical.add(s.id)
        prior.push(s)
      }
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
      const wasPr = opts.deriveHistorical ? false : s.was_pr
      const wasPos = opts.deriveHistorical ? false : s.was_position_pr
      if (
        !s.is_pr &&
        !s.is_position_pr &&
        s.was_pr === wasPr &&
        s.was_position_pr === wasPos
      ) {
        return s
      }
      return {
        ...s,
        is_pr: false,
        was_pr: wasPr,
        is_position_pr: false,
        was_position_pr: wasPos,
      }
    }
    const isPr = overall.current.has(s.id)
    const wasPr = opts.deriveHistorical
      ? overall.historical.has(s.id)
      : s.was_pr || isPr
    const isPosPr = posCurrent.has(s.id)
    const wasPosPr = opts.deriveHistorical
      ? posHistorical.has(s.id)
      : s.was_position_pr || isPosPr
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
