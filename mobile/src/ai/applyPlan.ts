import {
  DEFAULT_CATEGORIES,
  listExercisesQ,
  localApi,
} from "@lift/core"
import type { Category, ExerciseKind } from "@lift/core"
import type { AiPlanExercise, AiPlanResponse } from "./types"

export interface ApplyResult {
  appliedDates: string[]
  errors: { date: string; message: string }[]
}

/**
 * Applies a parsed AI plan to the local store. One workout per day; existing
 * workouts on the same date are NOT overwritten — the new exercises append.
 */
export async function applyPlan(plan: AiPlanResponse): Promise<ApplyResult> {
  const applied: string[] = []
  const errors: { date: string; message: string }[] = []

  for (const day of plan.days) {
    if (!day.exercises || day.exercises.length === 0) continue
    try {
      const workout = await localApi.createWorkout(day.date)
      for (const ex of day.exercises) {
        if (!ex.name) continue
        const exerciseId = await resolveExerciseId(ex)
        const we = await localApi.addExerciseToWorkout(workout.id, exerciseId)
        for (const set of ex.sets ?? []) {
          await localApi.addPlannedSet(we.id, {
            weight: set.weight ?? null,
            reps: set.reps ?? null,
            distance_m: set.distance_m ?? null,
            time_seconds: set.time_seconds ?? null,
            note: set.note ?? "",
          })
        }
      }
      applied.push(day.date)
    } catch (e) {
      errors.push({
        date: day.date,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { appliedDates: applied, errors }
}

async function resolveExerciseId(ex: AiPlanExercise): Promise<number> {
  const matches = listExercisesQ({ q: ex.name })
  const exact = matches.find((m) => m.name.toLowerCase() === ex.name.toLowerCase())
  if (exact) return exact.id
  if (matches.length > 0) return matches[0].id

  const category = pickCategory(ex.category)
  const kind = pickKind(ex.kind)
  const created = await localApi.createExercise({
    name: ex.name,
    category,
    kind,
  })
  return created.id
}

function pickCategory(c?: Category): Category {
  if (c && DEFAULT_CATEGORIES.includes(c)) return c
  return "chest"
}

function pickKind(k?: ExerciseKind): ExerciseKind {
  if (k === "weight_reps" || k === "distance_time" || k === "bodyweight_reps" || k === "time_only") {
    return k
  }
  return "weight_reps"
}
