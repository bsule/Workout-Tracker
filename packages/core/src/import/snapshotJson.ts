/**
 * Importer for the JSON snapshot produced by export/snapshot.ts:buildJson().
 * Mirrors the API of fitnotesCsv.ts so the two importers can be plugged into
 * the same UI flow. Like the FitNotes path, we build a snapshot diff in plain
 * JS and apply it in a single applyMutation() call to keep large imports cheap.
 */

import { nextId } from "../store/ids"
import { recomputeAllPrs } from "../store/mutations"
import { flushNow, runBatched } from "../store/persist"
import type {
  ExerciseRow,
  GymRow,
  SetRow,
  Snapshot,
  WorkoutExerciseRow,
  WorkoutRow,
} from "../store/schema"
import { applyMutation, getState } from "../store/store"
import type { Category, ExerciseKind } from "../types"
import { DEFAULT_CATEGORIES } from "../types"
import type { ImportMode, ImportResult } from "./fitnotesCsv"

const VALID_KINDS: ExerciseKind[] = [
  "weight_reps",
  "distance_time",
  "bodyweight_reps",
  "time_only",
]

export interface SnapshotJsonPreview {
  format: "lift-snapshot" | "unknown"
  version: number
  workoutCount: number
  setCount: number
  customExerciseCount: number
  gymCount: number
  exportedAt: string | null
  reason?: string
}

interface RawJsonSet {
  weight_kg?: number | null
  reps?: number | null
  distance_m?: number | null
  distance_unit_display?: string | null
  time_seconds?: number | null
  is_pr?: boolean
  was_pr?: boolean
  note?: string | null
  order?: number
  created_at?: string | null
}

interface RawJsonExerciseRef {
  name: string
  category?: string
  kind?: string
  is_custom?: boolean
}

interface RawJsonWorkoutExercise {
  order?: number
  exercise: RawJsonExerciseRef
  sets?: RawJsonSet[]
}

interface RawJsonWorkout {
  id?: number
  date: string
  started_at?: string | null
  finished_at?: string | null
  gym?: string | null
  notes?: string | null
  exercises?: RawJsonWorkoutExercise[]
}

interface RawJsonPayload {
  version?: number
  exported_at?: string
  weight_unit?: string
  user?: { username?: string }
  custom_exercises?: Array<{ name: string; category?: string; kind?: string }>
  saved_gyms?: string[]
  workouts?: RawJsonWorkout[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function tryParse(text: string): RawJsonPayload | null {
  try {
    const v = JSON.parse(text)
    return isObject(v) ? (v as RawJsonPayload) : null
  } catch {
    return null
  }
}

export function previewSnapshotJson(text: string): SnapshotJsonPreview {
  const data = tryParse(text)
  if (!data) {
    return {
      format: "unknown",
      version: 0,
      workoutCount: 0,
      setCount: 0,
      customExerciseCount: 0,
      gymCount: 0,
      exportedAt: null,
      reason: "File is not valid JSON.",
    }
  }
  const looksLikeSnapshot =
    typeof data.version === "number" &&
    Array.isArray(data.workouts) &&
    Array.isArray(data.custom_exercises)
  if (!looksLikeSnapshot) {
    return {
      format: "unknown",
      version: typeof data.version === "number" ? data.version : 0,
      workoutCount: 0,
      setCount: 0,
      customExerciseCount: 0,
      gymCount: 0,
      exportedAt: typeof data.exported_at === "string" ? data.exported_at : null,
      reason: "Missing top-level workouts/custom_exercises arrays.",
    }
  }

  let setCount = 0
  for (const w of data.workouts ?? []) {
    for (const we of w.exercises ?? []) {
      setCount += (we.sets ?? []).length
    }
  }

  return {
    format: "lift-snapshot",
    version: data.version!,
    workoutCount: (data.workouts ?? []).length,
    setCount,
    customExerciseCount: (data.custom_exercises ?? []).length,
    gymCount: (data.saved_gyms ?? []).length,
    exportedAt: typeof data.exported_at === "string" ? data.exported_at : null,
  }
}

function normalizeCategory(raw: string | undefined): Category {
  const c = (raw || "").trim().toLowerCase()
  if (!c) return "chest"
  return c as Category
}

function normalizeKind(raw: string | undefined): ExerciseKind {
  const k = (raw || "").trim()
  return (VALID_KINDS as string[]).includes(k) ? (k as ExerciseKind) : "weight_reps"
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function importSnapshotJson(
  text: string,
  opts: { mode: ImportMode } = { mode: "merge" }
): Promise<ImportResult> {
  const mode = opts.mode
  const data = tryParse(text)
  const errors: { row: number; message: string }[] = []
  const exercisesCreated = new Set<string>()

  if (!data || !Array.isArray(data.workouts)) {
    if (mode === "replace") {
      await runBatched(async () => {
        applyMutation((s: Snapshot) => ({
          ...s,
          exercises: [],
          workouts: [],
          workout_exercises: [],
          sets: [],
        }))
      })
      await flushNow()
    }
    return {
      imported: 0,
      exercisesCreated: [],
      errors: data
        ? errors
        : [{ row: 0, message: "File is not a valid JSON snapshot." }],
    }
  }

  const snap = getState().snapshot

  // Build merge keys: exercise by lowercase name (matches FitNotes importer),
  // workout by date+gym so a re-import of the same file is a no-op in merge
  // mode.
  const exerciseByName = new Map<string, ExerciseRow>(
    mode === "replace"
      ? []
      : snap.exercises.map((e) => [e.name.toLowerCase(), e])
  )
  const workoutByDateGym = new Map<string, WorkoutRow>(
    mode === "replace"
      ? []
      : snap.workouts.map((w) => [`${w.date}|${(w.gym || "").toLowerCase()}`, w])
  )
  const wesByPair = new Map<string, WorkoutExerciseRow>(
    mode === "replace"
      ? []
      : snap.workout_exercises.map((we) => [
          `${we.workout_id}:${we.exercise_id}`,
          we,
        ])
  )
  const gymsByName = new Map<string, GymRow>(
    mode === "replace"
      ? []
      : snap.gyms.map((g) => [g.name.toLowerCase(), g])
  )
  // Track existing (workout, exercise, position) triples so re-importing the
  // same JSON doesn't duplicate sets in merge mode. We key sets by their order
  // within the workout-exercise; the exporter writes deterministic orders.
  const existingSetKeys = new Set<string>()
  if (mode === "merge") {
    for (const s of snap.sets) {
      if (s.is_planned) continue
      existingSetKeys.add(`${s.workout_exercise_id}:${s.order}`)
    }
  }

  const newExercises: ExerciseRow[] = []
  const newWorkouts: WorkoutRow[] = []
  const newWes: WorkoutExerciseRow[] = []
  const newSets: SetRow[] = []
  const newGyms: GymRow[] = []
  const weSetCounts = new Map<number, number>()
  if (mode === "merge") {
    for (const s of snap.sets) {
      if (s.is_planned) continue
      weSetCounts.set(
        s.workout_exercise_id,
        (weSetCounts.get(s.workout_exercise_id) ?? 0) + 1
      )
    }
  }

  // Saved gyms (string list).
  for (const name of data.saved_gyms ?? []) {
    if (typeof name !== "string") continue
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (gymsByName.has(key)) continue
    const row: GymRow = { id: nextId(), name: trimmed }
    gymsByName.set(key, row)
    newGyms.push(row)
  }

  // Custom exercises declared at the top level — make sure they exist before
  // we walk the workouts, so workouts referencing the same name reuse the
  // resolved row instead of inferring `is_custom`.
  for (const ce of data.custom_exercises ?? []) {
    if (!ce || typeof ce.name !== "string") continue
    const name = ce.name.trim()
    if (!name) continue
    if (exerciseByName.has(name.toLowerCase())) continue
    const cat = normalizeCategory(ce.category)
    const ex: ExerciseRow = {
      id: nextId(),
      name,
      category: (DEFAULT_CATEGORIES as string[]).includes(cat)
        ? (cat as Category)
        : cat,
      kind: normalizeKind(ce.kind),
      is_custom: true,
    }
    exerciseByName.set(name.toLowerCase(), ex)
    newExercises.push(ex)
    exercisesCreated.add(name)
  }

  let imported = 0
  let workoutIndex = 0

  for (const w of data.workouts ?? []) {
    workoutIndex++
    if (!w || typeof w.date !== "string") {
      errors.push({ row: workoutIndex, message: "Workout missing date." })
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) {
      errors.push({ row: workoutIndex, message: `Bad workout date "${w.date}".` })
      continue
    }

    const gym = (w.gym ?? "").toString()
    const workoutKey = `${w.date}|${gym.toLowerCase()}`
    let workout = workoutByDateGym.get(workoutKey)
    if (!workout) {
      const status =
        w.finished_at
          ? "done"
          : w.started_at
            ? "active"
            : "done"
      workout = {
        id: nextId(),
        date: w.date,
        status,
        started_at: w.started_at ?? null,
        finished_at: w.finished_at ?? null,
        gym,
        notes: (w.notes ?? "").toString(),
        created_at: nowIso(),
      }
      workoutByDateGym.set(workoutKey, workout)
      newWorkouts.push(workout)
    }

    const exercises = Array.isArray(w.exercises) ? w.exercises : []
    for (const we of exercises) {
      if (!we || !we.exercise || typeof we.exercise.name !== "string") {
        errors.push({
          row: workoutIndex,
          message: "Workout exercise missing name.",
        })
        continue
      }
      const exName = we.exercise.name.trim()
      if (!exName) continue

      let exRow = exerciseByName.get(exName.toLowerCase())
      if (!exRow) {
        const cat = normalizeCategory(we.exercise.category)
        exRow = {
          id: nextId(),
          name: exName,
          category: (DEFAULT_CATEGORIES as string[]).includes(cat)
            ? (cat as Category)
            : cat,
          kind: normalizeKind(we.exercise.kind),
          is_custom: we.exercise.is_custom !== false,
        }
        exerciseByName.set(exName.toLowerCase(), exRow)
        newExercises.push(exRow)
        exercisesCreated.add(exName)
      }

      const pairKey = `${workout.id}:${exRow.id}`
      let weRow = wesByPair.get(pairKey)
      if (!weRow) {
        let siblings = 0
        if (mode === "merge") {
          for (const x of snap.workout_exercises)
            if (x.workout_id === workout.id) siblings++
        }
        for (const x of newWes) if (x.workout_id === workout.id) siblings++
        weRow = {
          id: nextId(),
          workout_id: workout.id,
          exercise_id: exRow.id,
          order: typeof we.order === "number" ? we.order : siblings,
        }
        wesByPair.set(pairKey, weRow)
        newWes.push(weRow)
      }

      const sets = Array.isArray(we.sets) ? we.sets : []
      for (const s of sets) {
        if (!s) continue
        const order =
          typeof s.order === "number"
            ? s.order
            : weSetCounts.get(weRow.id) ?? 0
        const dedupeKey = `${weRow.id}:${order}`
        if (mode === "merge" && existingSetKeys.has(dedupeKey)) continue
        existingSetKeys.add(dedupeKey)

        weSetCounts.set(weRow.id, (weSetCounts.get(weRow.id) ?? 0) + 1)
        newSets.push({
          id: nextId(),
          workout_exercise_id: weRow.id,
          weight: typeof s.weight_kg === "number" ? s.weight_kg : null,
          reps: typeof s.reps === "number" ? s.reps : null,
          distance_m: typeof s.distance_m === "number" ? s.distance_m : null,
          distance_unit_display: (s.distance_unit_display ?? "").toString(),
          time_seconds:
            typeof s.time_seconds === "number" ? s.time_seconds : null,
          is_planned: false,
          is_pr: !!s.is_pr,
          was_pr: !!s.was_pr,
          is_position_pr: false,
          was_position_pr: false,
          note: (s.note ?? "").toString(),
          order,
          created_at:
            typeof s.created_at === "string" && s.created_at
              ? s.created_at
              : nowIso(),
        })
        imported++
      }
    }
  }

  await runBatched(async () => {
    applyMutation((s: Snapshot) => {
      const base: Snapshot =
        mode === "replace"
          ? {
              ...s,
              exercises: [],
              workouts: [],
              workout_exercises: [],
              sets: [],
            }
          : s
      return {
        ...base,
        exercises: newExercises.length
          ? [...base.exercises, ...newExercises]
          : base.exercises,
        workouts: newWorkouts.length
          ? [...base.workouts, ...newWorkouts]
          : base.workouts,
        workout_exercises: newWes.length
          ? [...base.workout_exercises, ...newWes]
          : base.workout_exercises,
        sets: newSets.length ? [...base.sets, ...newSets] : base.sets,
        gyms: newGyms.length ? [...base.gyms, ...newGyms] : base.gyms,
      }
    })
    if (imported > 0 || newExercises.length > 0) recomputeAllPrs()
  })
  await flushNow()

  return {
    imported,
    exercisesCreated: [...exercisesCreated].sort(),
    errors,
  }
}
