/**
 * Tiny snapshot builder for tests that need to assert on derived state
 * (indexes, queries, PR computation) without driving the full mutation API.
 *
 * Rows use explicit ids so assertions can reference them directly.
 */

import { emptySnapshot, type Snapshot, type SetRow } from "@lift/core/store/schema"
import type { Category, ExerciseKind } from "@lift/core/types"

export function blankSnapshot(): Snapshot {
  return emptySnapshot("test-device")
}

export function exercise(
  id: number,
  name: string,
  category: Category = "chest",
  kind: ExerciseKind = "weight_reps"
) {
  return { id, name, category, kind, is_custom: true }
}

export function workout(id: number, date: string, gym = "", status: "planned" | "active" | "done" = "done") {
  return {
    id,
    date,
    status,
    started_at: null,
    finished_at: null,
    gym,
    notes: "",
    created_at: `${date}T08:00:00.000Z`,
  }
}

export function we(id: number, workoutId: number, exerciseId: number, order = 0) {
  return { id, workout_id: workoutId, exercise_id: exerciseId, order }
}

export function set(
  id: number,
  weId: number,
  fields: Partial<SetRow> & { weight?: number | null; reps?: number | null }
): SetRow {
  return {
    id,
    workout_exercise_id: weId,
    weight: fields.weight ?? null,
    reps: fields.reps ?? null,
    distance_m: fields.distance_m ?? null,
    distance_unit_display: fields.distance_unit_display ?? "",
    time_seconds: fields.time_seconds ?? null,
    is_planned: fields.is_planned ?? false,
    is_pr: fields.is_pr ?? false,
    was_pr: fields.was_pr ?? false,
    is_position_pr: fields.is_position_pr ?? false,
    was_position_pr: fields.was_position_pr ?? false,
    note: fields.note ?? "",
    order: fields.order ?? 0,
    created_at: fields.created_at ?? "2026-01-01T08:00:00.000Z",
  }
}
