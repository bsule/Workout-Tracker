import type { Category, ExerciseKind, UserSettings, WorkoutStatus } from "../types"
import { applyMutation, getState } from "./store"
import { nextId } from "./ids"
import { recordPending } from "./persist"
import type {
  ExerciseRow,
  GymRow,
  SetRow,
  Snapshot,
  WorkoutExerciseRow,
  WorkoutRow,
} from "./schema"
import { FIRST_CUSTOM_ID, SEED_EXERCISES, isSeedId } from "./seed"

// All mutations follow the same shape:
// 1. Compute next snapshot (immutable update).
// 2. applyMutation -> rebuild indexes, emit, mark dirty.
// 3. recordPending(op) for crash recovery + future R2 sync.

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}
function nowIso() {
  return new Date().toISOString()
}

function inferStatus(date: string): WorkoutStatus {
  const today = todayString()
  if (date < today) return "done"
  if (date === today) return "active"
  return "planned"
}

// ---- settings -----------------------------------------------------

export function updateSettings(patch: Partial<UserSettings>): UserSettings {
  let result: UserSettings = { weight_unit: "lb", first_day_of_week: 0 }
  applyMutation((snap) => {
    const next = { ...snap.settings, ...patch }
    result = next
    return { ...snap, settings: next }
  })
  recordPending({ op: "update_settings", patch })
  return result
}

// ---- exercises ----------------------------------------------------

export function createExercise(input: {
  name: string
  category: Category
  kind?: ExerciseKind
}): ExerciseRow {
  const id = Math.max(nextId(), FIRST_CUSTOM_ID)
  const row: ExerciseRow = {
    id,
    name: input.name.trim(),
    category: input.category,
    kind: input.kind ?? "weight_reps",
    is_custom: true,
  }
  applyMutation((snap) => ({ ...snap, exercises: [...snap.exercises, row] }))
  recordPending({ op: "create_exercise", row })
  return row
}

export function patchExercise(
  id: number,
  patch: Partial<Pick<ExerciseRow, "name" | "category">>
): ExerciseRow | null {
  let result: ExerciseRow | null = null
  applyMutation((snap) => {
    const idx = snap.exercises.findIndex((e) => e.id === id)
    const existing = idx >= 0 ? snap.exercises[idx] : undefined
    const seed = isSeedId(id)
      ? SEED_EXERCISES.find((e) => e.id === id)
      : undefined
    const cur = existing ?? seed
    if (!cur) return snap

    const name = patch.name !== undefined ? patch.name.trim() : cur.name
    if (!name) return snap
    const category = patch.category ?? cur.category

    const next: ExerciseRow = { ...cur, name, category }
    result = next
    const exercises = snap.exercises.slice()
    if (idx >= 0) exercises[idx] = next
    else exercises.push(next)
    return { ...snap, exercises }
  })
  if (result) {
    recordPending({ op: "patch_exercise", id, row: result })
  }
  return result
}

export function deleteExercise(id: number): void {
  let deletedRow: ExerciseRow | null = null
  applyMutation((snap) => {
    const referenced = snap.workout_exercises.some((we) => we.exercise_id === id)
    const idx = snap.exercises.findIndex((e) => e.id === id)
    const existing = idx >= 0 ? snap.exercises[idx] : undefined
    const seed = isSeedId(id)
      ? SEED_EXERCISES.find((e) => e.id === id)
      : undefined

    if (referenced || seed) {
      const cur = existing ?? seed
      if (!cur) return snap
      const next: ExerciseRow = { ...cur, is_deleted: true }
      deletedRow = next
      const exercises = snap.exercises.slice()
      if (idx >= 0) exercises[idx] = next
      else exercises.push(next)
      return { ...snap, exercises }
    }

    if (id < FIRST_CUSTOM_ID) return snap
    return {
      ...snap,
      exercises: snap.exercises.filter((e) => e.id !== id),
    }
  })
  recordPending({ op: "delete_exercise", id, row: deletedRow })
}

// ---- workouts -----------------------------------------------------

export interface CreateWorkoutResult {
  row: WorkoutRow
  /** True if we returned an existing workout that was already finished
   *  (two-a-day cap — caller should warn before proceeding). */
  merged_into_finished: boolean
}

export function createWorkout(date: string): CreateWorkoutResult {
  const existing = getState().snapshot.workouts.find((w) => w.date === date)
  if (existing) {
    return {
      row: existing,
      merged_into_finished: existing.finished_at != null,
    }
  }
  const status = inferStatus(date)
  const now = nowIso()
  const row: WorkoutRow = {
    id: nextId(),
    date,
    status,
    started_at: status === "active" ? now : null,
    finished_at: null,
    gym: "",
    notes: "",
    created_at: now,
  }
  applyMutation((snap) => {
    const dup = snap.workouts.find((w) => w.date === date)
    if (dup) return snap
    return { ...snap, workouts: [...snap.workouts, row] }
  })
  recordPending({ op: "create_workout", row })
  return { row, merged_into_finished: false }
}

export function deleteWorkout(id: number): void {
  applyMutation((snap) => {
    const wes = snap.workout_exercises.filter((we) => we.workout_id === id)
    const weIds = new Set(wes.map((we) => we.id))
    return {
      ...snap,
      workouts: snap.workouts.filter((w) => w.id !== id),
      workout_exercises: snap.workout_exercises.filter(
        (we) => we.workout_id !== id
      ),
      sets: snap.sets.filter((s) => !weIds.has(s.workout_exercise_id)),
    }
  })
  recordPending({ op: "delete_workout", id })
}

export function patchWorkout(
  id: number,
  patch: Partial<
    Pick<WorkoutRow, "notes" | "started_at" | "finished_at" | "gym" | "status">
  >
): WorkoutRow | null {
  let result: WorkoutRow | null = null
  applyMutation((snap) => {
    const idx = snap.workouts.findIndex((w) => w.id === id)
    if (idx < 0) return snap
    const next = { ...snap.workouts[idx], ...patch }
    result = next
    const workouts = snap.workouts.slice()
    workouts[idx] = next
    let gyms = snap.gyms
    if (typeof patch.gym === "string" && patch.gym.trim()) {
      const name = patch.gym.trim()
      if (!gyms.some((g) => g.name === name)) {
        gyms = [...gyms, { id: nextId(), name }]
      }
    }
    return { ...snap, workouts, gyms }
  })
  recordPending({ op: "patch_workout", id, patch })
  return result
}

export function startPlannedWorkout(id: number): WorkoutRow | null {
  return patchWorkout(id, { status: "active", started_at: nowIso() })
}

export function finishWorkout(id: number): WorkoutRow | null {
  return patchWorkout(id, { status: "done", finished_at: nowIso() })
}

// ---- workout exercises -------------------------------------------

export function addExerciseToWorkout(
  workoutId: number,
  exerciseId: number
): WorkoutExerciseRow {
  const existing = getState().snapshot.workout_exercises.find(
    (we) => we.workout_id === workoutId && we.exercise_id === exerciseId
  )
  if (existing) return existing
  const row: WorkoutExerciseRow = {
    id: nextId(),
    workout_id: workoutId,
    exercise_id: exerciseId,
    order: 0,
  }
  applyMutation((snap) => {
    const dup = snap.workout_exercises.find(
      (we) => we.workout_id === workoutId && we.exercise_id === exerciseId
    )
    if (dup) return snap
    const siblings = snap.workout_exercises.filter(
      (we) => we.workout_id === workoutId
    )
    row.order = siblings.length
    return {
      ...snap,
      workout_exercises: [...snap.workout_exercises, row],
    }
  })
  recordPending({ op: "add_exercise", row })
  return row
}

export function removeExerciseFromWorkout(
  workoutId: number,
  weId: number
): void {
  applyMutation((snap) => ({
    ...snap,
    workout_exercises: snap.workout_exercises.filter((we) => we.id !== weId),
    sets: snap.sets.filter((s) => s.workout_exercise_id !== weId),
  }))
  recordPending({ op: "remove_exercise", workoutId, weId })
}

// ---- sets ---------------------------------------------------------

export interface AddSetInput {
  weight?: number | null
  reps?: number | null
  distance_m?: number | null
  distance_unit_display?: string
  time_seconds?: number | null
  note?: string
  is_planned?: boolean
}

export function addSet(weId: number, input: AddSetInput): SetRow {
  const row: SetRow = {
    id: nextId(),
    workout_exercise_id: weId,
    weight: input.weight ?? null,
    reps: input.reps ?? null,
    distance_m: input.distance_m ?? null,
    distance_unit_display: input.distance_unit_display ?? "",
    time_seconds: input.time_seconds ?? null,
    is_planned: !!input.is_planned,
    is_pr: false,
    was_pr: false,
    is_position_pr: false,
    was_position_pr: false,
    note: input.note ?? "",
    order: 0,
    created_at: nowIso(),
  }
  applyMutation((snap) => {
    const siblings = snap.sets.filter((s) => s.workout_exercise_id === weId)
    // Use max(existing order)+1 — `siblings.length` collides with an existing
    // order when a middle set was deleted (e.g. delete order=1 from [0,1,2],
    // siblings.length is 2, which clashes with order=2 and re-orders the row
    // into the deleted slot under the unstable sort).
    row.order = siblings.reduce((m, s) => Math.max(m, s.order), -1) + 1
    let next = { ...snap, sets: [...snap.sets, row] }
    if (!row.is_planned) next = recomputePrsForWe(next, weId)
    return next
  })
  recordPending({ op: "add_set", row })
  return row
}

export function logPlannedSet(
  setId: number,
  patch: { weight?: number; reps?: number; note?: string }
): SetRow | null {
  let updated: SetRow | null = null
  applyMutation((snap) => {
    const idx = snap.sets.findIndex((s) => s.id === setId)
    if (idx < 0) return snap
    const cur = snap.sets[idx]
    const next: SetRow = {
      ...cur,
      weight: patch.weight ?? cur.weight,
      reps: patch.reps ?? cur.reps,
      note: patch.note ?? cur.note,
      is_planned: false,
      created_at: nowIso(),
    }
    updated = next
    const sets = snap.sets.slice()
    sets[idx] = next
    return recomputePrsForWe({ ...snap, sets }, cur.workout_exercise_id)
  })
  recordPending({ op: "log_planned_set", setId, patch })
  return updated
}

export function updateSet(
  setId: number,
  patch: { weight?: number; reps?: number; note?: string; created_at?: string }
): SetRow | null {
  let updated: SetRow | null = null
  applyMutation((snap) => {
    const idx = snap.sets.findIndex((s) => s.id === setId)
    if (idx < 0) return snap
    const cur = snap.sets[idx]
    const next: SetRow = {
      ...cur,
      weight: patch.weight ?? cur.weight,
      reps: patch.reps ?? cur.reps,
      note: patch.note ?? cur.note,
      created_at: patch.created_at ?? cur.created_at,
    }
    updated = next
    const sets = snap.sets.slice()
    sets[idx] = next
    return recomputePrsForWe({ ...snap, sets }, cur.workout_exercise_id)
  })
  recordPending({ op: "update_set", setId, patch })
  return updated
}

export function deleteSet(setId: number): void {
  applyMutation((snap) => {
    const target = snap.sets.find((s) => s.id === setId)
    if (!target) return snap
    const next = { ...snap, sets: snap.sets.filter((s) => s.id !== setId) }
    return recomputePrsForWe(next, target.workout_exercise_id)
  })
  recordPending({ op: "delete_set", setId })
}

// ---- gyms ---------------------------------------------------------

export function createGym(name: string): GymRow {
  const row: GymRow = { id: nextId(), name: name.trim() }
  applyMutation((snap) => {
    if (snap.gyms.some((g) => g.name === row.name)) return snap
    return { ...snap, gyms: [...snap.gyms, row] }
  })
  recordPending({ op: "create_gym", row })
  return row
}

export function deleteGym(id: number): void {
  applyMutation((snap) => ({
    ...snap,
    gyms: snap.gyms.filter((g) => g.id !== id),
  }))
  recordPending({ op: "delete_gym", id })
}

// Rename a gym and rewrite the `gym` field on every workout that
// referenced the old name. Returns null on no-op (missing id, empty
// name, or a name collision with another saved gym).
export function renameGym(id: number, name: string): GymRow | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  let result: GymRow | null = null
  let oldName: string | null = null
  applyMutation((snap) => {
    const idx = snap.gyms.findIndex((g) => g.id === id)
    if (idx < 0) return snap
    const current = snap.gyms[idx]
    if (current.name === trimmed) {
      result = current
      return snap
    }
    if (snap.gyms.some((g, i) => i !== idx && g.name === trimmed)) return snap
    oldName = current.name
    const next: GymRow = { ...current, name: trimmed }
    result = next
    const gyms = snap.gyms.slice()
    gyms[idx] = next
    const workouts = snap.workouts.map((w) =>
      w.gym === oldName ? { ...w, gym: trimmed } : w
    )
    return { ...snap, gyms, workouts }
  })
  if (result && oldName !== null) {
    recordPending({ op: "rename_gym", id, oldName, newName: trimmed })
  }
  return result
}

// ---- copy from previous ------------------------------------------

export function copyFromWorkout(
  targetId: number,
  sourceId: number,
  withSets = false
): void {
  applyMutation((snap) => {
    const sourceWes = snap.workout_exercises.filter(
      (we) => we.workout_id === sourceId
    )
    if (sourceWes.length === 0) return snap
    const newWes: WorkoutExerciseRow[] = []
    const newSets: SetRow[] = []
    let order = snap.workout_exercises.filter(
      (we) => we.workout_id === targetId
    ).length
    for (const swe of sourceWes) {
      const newWe: WorkoutExerciseRow = {
        id: nextId(),
        workout_id: targetId,
        exercise_id: swe.exercise_id,
        order: order++,
      }
      newWes.push(newWe)
      if (withSets) {
        const sourceSets = snap.sets
          .filter((s) => s.workout_exercise_id === swe.id)
          .sort((a, b) => a.order - b.order)
        for (const ss of sourceSets) {
          newSets.push({
            id: nextId(),
            workout_exercise_id: newWe.id,
            weight: ss.weight,
            reps: ss.reps,
            distance_m: ss.distance_m,
            distance_unit_display: ss.distance_unit_display,
            time_seconds: ss.time_seconds,
            is_planned: ss.is_planned,
            is_pr: false,
            was_pr: false,
            is_position_pr: false,
            was_position_pr: false,
            note: ss.note,
            order: ss.order,
            created_at: nowIso(),
          })
        }
      }
    }
    return {
      ...snap,
      workout_exercises: [...snap.workout_exercises, ...newWes],
      sets: [...snap.sets, ...newSets],
    }
  })
  recordPending({ op: "copy_from", targetId, sourceId, withSets })
}

// ---- PRs ----------------------------------------------------------

function recomputePrsForWe(snap: Snapshot, weId: number): Snapshot {
  const we = snap.workout_exercises.find((x) => x.id === weId)
  if (!we) return snap
  return recomputePrsForExercise(snap, we.exercise_id)
}

function recomputePrsForExercise(
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

export function recomputeAllPrs(): { recomputed: number } {
  let count = 0
  applyMutation((snap) => {
    let next = snap
    const exerciseIds = new Set(
      snap.workout_exercises.map((we) => we.exercise_id)
    )
    for (const id of exerciseIds) {
      next = recomputePrsForExercise(next, id, { deriveHistorical: true })
    }
    count = exerciseIds.size
    return next
  })
  recordPending({ op: "recompute_prs" })
  return { recomputed: count }
}
