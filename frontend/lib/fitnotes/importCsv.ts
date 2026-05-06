/**
 * FitNotes Android CSV importer (local-first). Parses the CSV in the browser
 * and writes everything into the IndexedDB-backed snapshot. Distance, time,
 * notes, and exercise kind all round-trip with no data loss.
 *
 * For a 9000-row import we cannot call addSet() in a loop — that's
 * O(n²) (each call rebuilds indexes, recomputes PRs, and copies the sets
 * array). Instead we build a snapshot diff in plain JS and apply it in one
 * shot, then run a single PR recompute pass at the end.
 */

import { applyMutation, getState } from "@/lib/store/store"
import { recomputeAllPrs } from "@/lib/store/mutations"
import { flushNow, runBatched } from "@/lib/store/persist"
import { nextId } from "@/lib/store/ids"
import type {
  ExerciseRow,
  SetRow,
  Snapshot,
  WorkoutExerciseRow,
  WorkoutRow,
} from "@/lib/store/schema"
import { todayLocal } from "@/lib/utils"
import type { Category, ExerciseKind } from "@/types"

export const FITNOTES_HEADERS = [
  "Date",
  "Exercise",
  "Category",
  "Weight (kg)",
  "Weight (lbs)",
  "Reps",
  "Distance",
  "Distance Unit",
  "Time",
  "Notes",
  "Kind",
] as const

const KIND_MAP: Record<string, ExerciseKind> = {
  wr: "weight_reps",
  dt: "distance_time",
  br: "bodyweight_reps",
  t: "time_only",
}

const DIST_TO_METERS: Record<string, number> = {
  mi: 1609.344,
  km: 1000.0,
  ft: 0.3048,
  m: 1.0,
}

const KG_PER_LB = 0.45359237
const MAX_REPS = 100

const DEFAULT_CATEGORIES: Category[] = [
  "abs",
  "back",
  "biceps",
  "cardio",
  "chest",
  "legs",
  "shoulders",
  "triceps",
]

export interface FitNotesPreview {
  format: "fitnotes" | "unknown"
  rowCount: number
  sample: Record<string, string>[]
  headers: string[]
}

export interface ImportResult {
  imported: number
  exercisesCreated: string[]
  errors: { row: number; message: string }[]
}

export async function previewCsv(file: File): Promise<FitNotesPreview> {
  const text = await file.text()
  const rows = parseCsv(text)
  const headers = rows.length ? Object.keys(rows[0]) : []
  const isFitNotes = FITNOTES_HEADERS.every((h) => headers.includes(h))
  return {
    format: isFitNotes ? "fitnotes" : "unknown",
    rowCount: rows.length,
    sample: rows.slice(0, 10),
    headers,
  }
}

export async function importFitnotesCsv(file: File): Promise<ImportResult> {
  const text = await file.text()
  const rows = parseCsv(text)
  if (rows.length === 0) {
    return { imported: 0, exercisesCreated: [], errors: [] }
  }

  const today = todayLocal()
  const errors: { row: number; message: string }[] = []
  const exercisesCreated = new Set<string>()

  // Build snapshot deltas in plain arrays/maps; merge into the live snapshot
  // in a single applyMutation at the end.
  const snap = getState().snapshot
  const exerciseByName = new Map<string, ExerciseRow>(
    snap.exercises.map((e) => [e.name.toLowerCase(), e])
  )
  const workoutByDate = new Map<string, WorkoutRow>(
    snap.workouts.map((w) => [w.date, w])
  )
  const wesByPair = new Map<string, WorkoutExerciseRow>(
    snap.workout_exercises.map((we) => [`${we.workout_id}:${we.exercise_id}`, we])
  )
  const newExercises: ExerciseRow[] = []
  const newWorkouts: WorkoutRow[] = []
  const newWes: WorkoutExerciseRow[] = []
  const newSets: SetRow[] = []
  const weSetCounts = new Map<number, number>()

  // Seed weSetCounts from existing snapshot so we order correctly when
  // appending sets to a workout-exercise that already has sets.
  for (const s of snap.sets) {
    if (s.is_planned) continue
    weSetCounts.set(
      s.workout_exercise_id,
      (weSetCounts.get(s.workout_exercise_id) ?? 0) + 1
    )
  }

  const nowIso = new Date().toISOString()
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNumber = i + 2

    try {
      const dateRaw = (row["Date"] || "").trim()
      const exName = normalizeName(row["Exercise"] || "")
      if (!dateRaw || !exName) {
        errors.push({ row: lineNumber, message: "Missing date or exercise." })
        continue
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        errors.push({ row: lineNumber, message: `Bad date "${dateRaw}".` })
        continue
      }
      if (dateRaw > today) {
        errors.push({ row: lineNumber, message: `Future date "${dateRaw}" skipped.` })
        continue
      }

      const kindRaw = (row["Kind"] || "").trim().toLowerCase()
      const kind: ExerciseKind = KIND_MAP[kindRaw] ?? "weight_reps"

      let weightKg: number | null = parseNum(row["Weight (kg)"])
      if (weightKg == null || weightKg <= 0) {
        const lbs = parseNum(row["Weight (lbs)"])
        weightKg = lbs != null && lbs > 0 ? lbs * KG_PER_LB : null
      }

      let reps: number | null = parseInteger(row["Reps"])
      if (reps != null && reps <= 0) reps = null
      if (reps != null && reps > MAX_REPS) {
        errors.push({
          row: lineNumber,
          message: `Reps ${reps} exceeds max ${MAX_REPS} (likely typo).`,
        })
        continue
      }

      const distRaw = parseNum(row["Distance"])
      const distUnit = (row["Distance Unit"] || "").trim().toLowerCase()
      let distanceM: number | null = null
      let distanceUnitDisplay = ""
      if (distRaw != null && distRaw > 0) {
        const mult = DIST_TO_METERS[distUnit]
        if (mult == null) {
          errors.push({
            row: lineNumber,
            message: `Unknown distance unit "${distUnit}".`,
          })
          continue
        }
        distanceM = distRaw * mult
        distanceUnitDisplay = distUnit
      }

      const timeSeconds = parseHms(row["Time"] || "")
      const note = (row["Notes"] || "").trim()

      if (reps == null && timeSeconds == null && distanceM == null) {
        errors.push({
          row: lineNumber,
          message: "Row has no reps, time, or distance.",
        })
        continue
      }

      // Resolve / create the exercise.
      let exRow = exerciseByName.get(exName.toLowerCase())
      if (!exRow) {
        const rawCat = (row["Category"] || "").trim().toLowerCase()
        const category: Category = (DEFAULT_CATEGORIES as string[]).includes(
          rawCat
        )
          ? (rawCat as Category)
          : (rawCat || "chest") as Category
        exRow = {
          id: nextId(),
          name: exName,
          category,
          kind,
          is_custom: true,
        }
        exerciseByName.set(exName.toLowerCase(), exRow)
        newExercises.push(exRow)
        exercisesCreated.add(exName)
      }

      // Resolve / create the workout.
      let workout = workoutByDate.get(dateRaw)
      if (!workout) {
        const status = dateRaw < today ? "done" : "active"
        workout = {
          id: nextId(),
          date: dateRaw,
          status,
          started_at: status === "active" ? nowIso : null,
          finished_at: null,
          gym: "",
          notes: "",
          created_at: nowIso,
        }
        workoutByDate.set(dateRaw, workout)
        newWorkouts.push(workout)
      }

      // Resolve / create the workout-exercise.
      const pairKey = `${workout.id}:${exRow.id}`
      let we = wesByPair.get(pairKey)
      if (!we) {
        const siblingsForWorkout = (() => {
          let n = 0
          for (const x of snap.workout_exercises)
            if (x.workout_id === workout!.id) n++
          for (const x of newWes) if (x.workout_id === workout!.id) n++
          return n
        })()
        we = {
          id: nextId(),
          workout_id: workout.id,
          exercise_id: exRow.id,
          order: siblingsForWorkout,
        }
        wesByPair.set(pairKey, we)
        newWes.push(we)
      }

      const setOrder = weSetCounts.get(we.id) ?? 0
      weSetCounts.set(we.id, setOrder + 1)
      newSets.push({
        id: nextId(),
        workout_exercise_id: we.id,
        weight: weightKg,
        reps,
        distance_m: distanceM,
        distance_unit_display: distanceUnitDisplay,
        time_seconds: timeSeconds,
        is_planned: false,
        is_pr: false,
        was_pr: false,
        note,
        order: setOrder,
        created_at: nowIso,
      })

      imported++
    } catch (e) {
      errors.push({
        row: lineNumber,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Apply everything in one mutation, with the per-op crash log paused so
  // appendPending isn't called 9000 times.
  await runBatched(async () => {
    applyMutation((s: Snapshot) => ({
      ...s,
      exercises: newExercises.length ? [...s.exercises, ...newExercises] : s.exercises,
      workouts: newWorkouts.length ? [...s.workouts, ...newWorkouts] : s.workouts,
      workout_exercises: newWes.length
        ? [...s.workout_exercises, ...newWes]
        : s.workout_exercises,
      sets: newSets.length ? [...s.sets, ...newSets] : s.sets,
    }))
    // Recompute PRs once, across all touched exercises. Internally only
    // weight_reps exercises actually do work.
    if (imported > 0) recomputeAllPrs()
  })
  await flushNow()

  return {
    imported,
    exercisesCreated: [...exercisesCreated].sort(),
    errors,
  }
}

// ---- helpers ------------------------------------------------------------

function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseInteger(v: string | undefined): number | null {
  const n = parseNum(v)
  return n == null ? null : Math.trunc(n)
}

function parseHms(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const parts = trimmed.split(":").map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function parseCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let i = 0
  let field = ""
  let row: string[] = []
  let inQuotes = false

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      row.push(field)
      field = ""
      i++
      continue
    }
    if (ch === "\r") {
      i++
      continue
    }
    if (ch === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i++
      continue
    }
    field += ch
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  if (rows.length === 0) return []
  const headers = rows[0]
  const out: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    if (cells.length === 1 && cells[0] === "") continue
    const obj: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cells[c] ?? ""
    }
    out.push(obj)
  }
  return out
}
