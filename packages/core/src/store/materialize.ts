import type {
  Exercise,
  HistorySet,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "../types"
import type { Indexes } from "./indexes"
import type {
  ExerciseRow,
  SetRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from "./schema"
import { SEED_EXERCISES } from "./seed"

export function exerciseFromRow(
  row: ExerciseRow | undefined,
  fallbackId: number,
  _ix: Indexes
): Exercise {
  if (row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      kind: row.kind,
      is_custom: row.is_custom,
    }
  }
  const seed = SEED_EXERCISES.find((e) => e.id === fallbackId)
  if (seed) {
    return {
      id: seed.id,
      name: seed.name,
      category: seed.category,
      kind: seed.category === "cardio" ? "distance_time" : "weight_reps",
      is_custom: false,
    }
  }
  return {
    id: fallbackId,
    name: `Unknown exercise (#${fallbackId})`,
    category: "chest",
    kind: "weight_reps",
    is_custom: true,
  }
}

export function exerciseLookup(id: number, ix: Indexes): Exercise {
  const row = ix.exerciseById.get(id)
  return exerciseFromRow(row, id, ix)
}

export function setFromRow(s: SetRow): WorkoutSet {
  return {
    id: s.id,
    weight: s.weight,
    reps: s.reps,
    distance_m: s.distance_m,
    distance_unit_display: s.distance_unit_display,
    time_seconds: s.time_seconds,
    is_pr: s.is_pr,
    was_pr: s.was_pr,
    is_position_pr: s.is_position_pr,
    was_position_pr: s.was_position_pr,
    note: s.note,
    order: s.order,
    is_planned: s.is_planned,
    created_at: s.created_at,
  }
}

export function weFromRow(
  we: WorkoutExerciseRow,
  ix: Indexes
): WorkoutExercise {
  const sets = (ix.setsByWorkoutExercise.get(we.id) ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(setFromRow)
  return {
    id: we.id,
    order: we.order,
    exercise: exerciseLookup(we.exercise_id, ix),
    sets,
  }
}

export function workoutFromRow(w: WorkoutRow, ix: Indexes): Workout {
  const exercises = (ix.workoutExercisesByWorkout.get(w.id) ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((we) => weFromRow(we, ix))
  const duration =
    w.started_at && w.finished_at
      ? Math.max(
          0,
          Math.round(
            (Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000
          )
        )
      : null
  return {
    id: w.id,
    date: w.date,
    status: w.status,
    started_at: w.started_at,
    finished_at: w.finished_at,
    duration_seconds: duration,
    gym: w.gym,
    notes: w.notes,
    exercises,
    created_at: w.created_at,
  }
}

export function historySetFromRow(s: SetRow): HistorySet {
  return {
    id: s.id,
    weight: s.weight,
    reps: s.reps,
    distance_m: s.distance_m,
    distance_unit_display: s.distance_unit_display,
    time_seconds: s.time_seconds,
    is_pr: s.is_pr,
    was_pr: s.was_pr,
    is_position_pr: s.is_position_pr,
    was_position_pr: s.was_position_pr,
    note: s.note,
    order: s.order,
    estimated_one_rm: estimateOneRm(s.weight, s.reps),
  }
}

export function estimateOneRm(
  weight: number | null,
  reps: number | null
): number {
  if (weight == null || !reps || reps <= 0) return 0
  if (reps === 1) return weight
  // Brzycki-ish, matches backend computation referenced in plan
  const denom = 1.0278 - 0.0278 * reps
  if (denom <= 0) return weight
  return weight / denom
}
