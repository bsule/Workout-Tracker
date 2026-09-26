import type { Category, ExerciseKind, UserSettings, WorkoutStatus } from "../types"

// v9: no shape change. was_pr / was_position_pr (the historical star) used to
//     be sticky on live changes and derived only on import, so edits, deletes
//     and sets logged on a past day left stale stars. They are now derived on
//     every pass; the bump alone makes hydrate() run recomputeAllPrs() once.
// v8: no shape change. PR comparison moved from raw kg floats to units.ts's
//     weightKey, so every stored is_pr / is_position_pr flag computed under the
//     old rule is stale. The bump alone makes hydrate() run recomputeAllPrs().
// v7: add note to WorkoutExerciseRow — a note about one exercise on one day.
// v6: workout.notes is canonical again — a per-session note that lives
//     alongside, not instead of, the per-date day_notes row.
// v5: add day_notes (per-date notes, independent of workouts).
// v4: add is_position_pr / was_position_pr to SetRow.
// v3: add soft-delete support to ExerciseRow.
// v2: add kind to ExerciseRow, distance/time fields to SetRow.
// Older snapshots are migrated in blob.ts:migrate().
export const SCHEMA_VERSION = 9

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
  /** Per-session note. Independent of the day_notes row for the same date. */
  notes: string
  created_at: string
}

export interface WorkoutExerciseRow {
  id: number
  workout_id: number
  exercise_id: number
  order: number
  /** Note about this exercise on this day. Narrower than workout.notes,
   *  which covers the whole session, and wider than SetRow.note, which
   *  covers one set. Dies with the workout_exercise. */
  note: string
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

/** A free-text note attached to a calendar date, not to a workout. */
export interface DayNoteRow {
  date: string
  text: string
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
  day_notes: DayNoteRow[]
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
    day_notes: [],
  }
}
