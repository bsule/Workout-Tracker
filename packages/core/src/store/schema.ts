import type { Category, ExerciseKind, UserSettings, WorkoutStatus } from "../types"

// v4: add is_position_pr / was_position_pr to SetRow.
// v3: add soft-delete support to ExerciseRow.
// v2: add kind to ExerciseRow, distance/time fields to SetRow.
// Older snapshots are migrated in blob.ts:migrate().
export const SCHEMA_VERSION = 4

export interface ExerciseRow {
  id: number
  name: string
  category: Category
  kind: ExerciseKind
  is_custom: boolean
  is_deleted?: boolean
}

export interface WorkoutRow {
  id: number
  date: string
  status: WorkoutStatus
  started_at: string | null
  finished_at: string | null
  gym: string
  notes: string
  created_at: string
}

export interface WorkoutExerciseRow {
  id: number
  workout_id: number
  exercise_id: number
  order: number
}

export interface SetRow {
  id: number
  workout_exercise_id: number
  // weight/reps null for cardio (distance_time) sets.
  weight: number | null
  reps: number | null
  // Canonical distance is meters; unit_display preserves the user's choice
  // ("mi" | "km" | "ft" | "m") for round-trip export.
  distance_m: number | null
  distance_unit_display: string
  time_seconds: number | null
  is_planned: boolean
  is_pr: boolean
  was_pr: boolean
  is_position_pr: boolean
  was_position_pr: boolean
  note: string
  order: number
  created_at: string
}

export interface GymRow {
  id: number
  name: string
}

export interface Snapshot {
  schema_version: number
  exported_at: string
  device_id: string
  settings: UserSettings
  exercises: ExerciseRow[]
  workouts: WorkoutRow[]
  workout_exercises: WorkoutExerciseRow[]
  sets: SetRow[]
  gyms: GymRow[]
}

export function emptySnapshot(deviceId: string): Snapshot {
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    device_id: deviceId,
    settings: { weight_unit: "lb", first_day_of_week: 0 },
    exercises: [],
    workouts: [],
    workout_exercises: [],
    sets: [],
    gyms: [],
  }
}
