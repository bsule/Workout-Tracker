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
  DayNoteRow,
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
import { weightKey } from "../units"
import { exerciseNameLookup, normalizeExerciseName } from "./exerciseNames"
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
  /** Absent in exports from before schema v7. */
  note?: string
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
  day_notes?: Array<{ date?: string; text?: string; notes?: string }>
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

/** True when the first character past any BOM and whitespace opens a JSON
 *  object or array. Both import screens use it to pick the JSON path over
 *  FitNotes CSV before parsing anything. */
export function looksLikeJson(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0xfeff) continue
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue
    return text[i] === "{" || text[i] === "["
  }
  return false
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

/** The kind a file states, or undefined when it states none (or garbage). */
function statedKind(raw: string | undefined): ExerciseKind | undefined {
  const k = (raw || "").trim()
  return (VALID_KINDS as string[]).includes(k) ? (k as ExerciseKind) : undefined
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
          day_notes: [],
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

  // Build merge keys: exercise by lowercase name, built-ins included (same as
  // the FitNotes importer). Workouts: one per date, like createWorkout, the
  // FitNotes importer and the date index. Matching on date + gym made a
  // second workout that day whenever the gyms differed, and the screens then
  // disagreed about which one the day was.
  const exerciseByName = exerciseNameLookup(
    mode === "replace" ? [] : snap.exercises
  )
  const workoutByDate = new Map<string, WorkoutRow>()
  if (mode === "merge") {
    for (const w of snap.workouts) {
      // First per date, the one createWorkout returns.
      if (!workoutByDate.has(w.date)) workoutByDate.set(w.date, w)
    }
  }
  // Workouts this import created, so a second file workout on the same date
  // can add its note and gym to it (rows from the device are left as they are).
  const createdHere = new Set<number>()
  const wesByPair = new Map<string, WorkoutExerciseRow>(
    mode === "replace"
      ? []
      : snap.workout_exercises.map((we) => [
          `${we.workout_id}:${we.exercise_id}`,
          we,
        ])
  )
  // Both modes: Replace clears workouts and exercises but keeps the saved
  // gyms (see `base` below), so the file's gyms must match against them too.
  // Starting from an empty map here added every gym a second time.
  const gymsByName = new Map<string, GymRow>(
    snap.gyms.map((g) => [g.name.toLowerCase(), g])
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
  const notesByDate = new Map<string, string>()
  const existingNoteDates = new Set(
    mode === "merge" ? (snap.day_notes ?? []).map((n) => n.date) : []
  )

  // Export v1 put the day note on `workouts[].notes`; v2 puts the per-session
  // note there and leaves the day note to `day_notes[]`. Read old files the
  // old way so a v1 export still restores its day notes.
  const workoutNotesAreSessionNotes = (data.version ?? 1) >= 2

  function takeDayNote(date: string, raw: string | null | undefined) {
    const text = (raw ?? "").toString().trim()
    if (!text) return
    if (existingNoteDates.has(date) || notesByDate.has(date)) return
    notesByDate.set(date, text)
  }

  for (const n of data.day_notes ?? []) {
    if (!n || typeof n.date !== "string") continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date)) continue
    takeDayNote(n.date, n.text ?? n.notes)
  }
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
    const name = normalizeExerciseName(ce.name)
    if (!name) continue
    if (exerciseByName.find(name, statedKind(ce.kind))) continue
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
    exerciseByName.add(ex)
    newExercises.push(ex)
    exercisesCreated.add(name)
  }

  // Per exercise row: the highest set order so far, whether a file entry
  // already went into it, and (lazily) the device's own sets on it by value.
  const maxOrder = new Map<number, number>()
  if (mode === "merge") {
    for (const s of snap.sets) {
      if (s.is_planned) continue
      maxOrder.set(
        s.workout_exercise_id,
        Math.max(maxOrder.get(s.workout_exercise_id) ?? -1, s.order)
      )
    }
  }
  const entriesSeen = new Set<number>()
  const localValues = new Map<number, Map<string, number>>()
  function localSetValues(weId: number): Map<string, number> {
    let m = localValues.get(weId)
    if (!m) {
      m = new Map()
      if (mode === "merge") {
        for (const s of snap.sets) {
          if (s.workout_exercise_id !== weId || s.is_planned) continue
          const k = setValueKey({
            weight_kg: s.weight,
            reps: s.reps,
            distance_m: s.distance_m,
            time_seconds: s.time_seconds,
          })
          m.set(k, (m.get(k) ?? 0) + 1)
        }
      }
      localValues.set(weId, m)
    }
    return m
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

    if (!workoutNotesAreSessionNotes) takeDayNote(w.date, w.notes)

    const rawGym = (w.gym ?? "").toString()
    // The saved gym's spelling ("GOLDS" in the file, "Golds" saved), so the
    // pickers highlight it and a rename carries it.
    const gym = gymsByName.get(rawGym.trim().toLowerCase())?.name ?? rawGym
    const sessionNote = workoutNotesAreSessionNotes ? (w.notes ?? "").toString().trim() : ""
    let workout = workoutByDate.get(w.date)
    // Same date and gym as a workout already on the device: this file is the
    // same session (an earlier export of it), and its sets dedupe by
    // position as before. Anything else joining an existing workout is added
    // after that workout's sets.
    const sameSession =
      !!workout &&
      !createdHere.has(workout.id) &&
      workout.gym.toLowerCase() === gym.toLowerCase()
    if (workout && createdHere.has(workout.id)) {
      if (!workout.gym && gym) workout.gym = gym
      if (sessionNote && !workout.notes.split("\n\n").includes(sessionNote)) {
        workout.notes = workout.notes ? `${workout.notes}\n\n${sessionNote}` : sessionNote
      }
    }
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
        notes: sessionNote,
        created_at: nowIso(),
      }
      workoutByDate.set(w.date, workout)
      createdHere.add(workout.id)
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
      const exName = normalizeExerciseName(we.exercise.name)
      if (!exName) continue

      let exRow = exerciseByName.find(exName, statedKind(we.exercise.kind))
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
        exerciseByName.add(exRow)
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
          note: typeof we.note === "string" ? we.note.trim() : "",
        }
        wesByPair.set(pairKey, weRow)
        newWes.push(weRow)
      }

      const sets = Array.isArray(we.sets) ? we.sets : []
      // A second session joining this exercise row (another workout that
      // day, in the file or on the device) goes after the sets already there.
      const appendAfter = !sameSession && (entriesSeen.has(weRow.id) || localSetValues(weRow.id).size > 0)
      entriesSeen.add(weRow.id)
      for (const s of sets) {
        if (!s) continue
        let order: number
        if (sameSession || !appendAfter) {
          order =
            typeof s.order === "number"
              ? s.order
              : weSetCounts.get(weRow.id) ?? 0
          const dedupeKey = `${weRow.id}:${order}`
          if (mode === "merge" && existingSetKeys.has(dedupeKey)) continue
          existingSetKeys.add(dedupeKey)
        } else {
          // Skip a set the device already has on this exercise that day (same
          // weight, reps, distance and time), so importing the file again
          // adds nothing; each saved set matches one file set at most.
          const values = localSetValues(weRow.id)
          const key = setValueKey(s)
          const left = values.get(key) ?? 0
          if (left > 0) {
            values.set(key, left - 1)
            continue
          }
          order = (maxOrder.get(weRow.id) ?? -1) + 1
          existingSetKeys.add(`${weRow.id}:${order}`)
        }
        maxOrder.set(weRow.id, Math.max(maxOrder.get(weRow.id) ?? -1, order))

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
              day_notes: [],
            }
          : s
      const newDayNotes: DayNoteRow[] = [...notesByDate].map(([date, text]) => ({
        date,
        text,
      }))
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
        day_notes: newDayNotes.length
          ? [...(base.day_notes ?? []), ...newDayNotes]
          : (base.day_notes ?? []),
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

/** What makes two sets the same set when a file is merged in: weight (by
 *  weightKey, so float noise from another device matches), reps, distance and
 *  time. */
function setValueKey(s: {
  weight_kg?: number | null
  reps?: number | null
  distance_m?: number | null
  time_seconds?: number | null
}): string {
  const w = typeof s.weight_kg === "number" ? String(weightKey(s.weight_kg)) : "-"
  const n = (v: number | null | undefined) => (typeof v === "number" ? String(v) : "-")
  return `${w}|${n(s.reps)}|${n(s.distance_m)}|${n(s.time_seconds)}`
}
