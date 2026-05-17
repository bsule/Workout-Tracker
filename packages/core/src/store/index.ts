import type {
  CalendarMap,
  Category,
  Exercise,
  ExerciseHistoryDay,
  Gym,
  UserSettings,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "../types"
import { exerciseFromRow, setFromRow, weFromRow } from "./materialize"
import * as M from "./mutations"
import * as Q from "./queries"
import { getState } from "./store"

export {
  addFlushListener,
  configure as configureStore,
  flushNow,
  hydrate as hydrateStore,
  removeFlushListener,
  runBatched,
} from "./persist"
export { getState, useStore, useHydrated, batchMutations } from "./store"
export {
  getPlannedWorkoutForToday,
  getPlannedDatesQ,
  getWorkoutByDateQ,
  getWorkoutQ,
  listGymsQ,
  listExercisesQ,
  fuzzyMatch,
  getExerciseHistoryQ,
  listWorkoutsQ,
  getCalendarQ,
} from "./queries"
export {
  startPlannedWorkout,
  finishWorkout,
  logPlannedSet,
  recomputeAllPrs,
  deleteWorkout,
  createWorkout,
  addExerciseToWorkout,
} from "./mutations"
export { estimateOneRm } from "./materialize"

/**
 * The ISO timestamp of the most recent logged set in a workout. The app uses
 * this as the workout's effective "end time" so the user doesn't have to
 * explicitly finish a workout — adding the last set is the end signal.
 * Returns null when there are no logged (non-planned) sets.
 */
export function lastSetTimeOf(workout: Workout): string | null {
  let max: number | null = null
  let maxIso: string | null = null
  for (const we of workout.exercises) {
    for (const s of we.sets) {
      if (s.is_planned) continue
      const t = Date.parse(s.created_at)
      if (!Number.isFinite(t)) continue
      if (max == null || t > max) {
        max = t
        maxIso = s.created_at
      }
    }
  }
  return maxIso
}

/**
 * Seconds between started_at and the last logged set. Null when either is
 * missing.
 */
export function workoutDurationSeconds(workout: Workout): number | null {
  if (!workout.started_at) return null
  const end = lastSetTimeOf(workout)
  if (!end) return null
  const diff = Math.round((Date.parse(end) - Date.parse(workout.started_at)) / 1000)
  return diff > 0 ? diff : null
}

// localApi is the data-access surface used by React components. Everything
// resolves synchronously against the in-memory snapshot but returns Promises
// to keep call sites uniform with the older networked API. The methods kept
// here are the ones with at least one component caller — see workoutFromRow
// for what gets returned.
export const localApi = {
  // settings
  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    return Promise.resolve(M.updateSettings(patch))
  },

  // exercises
  listExercises(params?: {
    category?: Category
    q?: string
    sort?: "name" | "last_performed"
  }): Promise<Exercise[]> {
    return Promise.resolve(Q.listExercisesQ(params))
  },
  createExercise(body: {
    name: string
    category: Category
    kind?: import("../types").ExerciseKind
  }): Promise<Exercise> {
    const row = M.createExercise(body)
    return Promise.resolve(exerciseFromRow(row, row.id, getState().indexes))
  },
  patchExercise(
    id: number,
    patch: { name?: string; category?: Category }
  ): Promise<Exercise> {
    const row = M.patchExercise(id, patch)
    if (!row) return Promise.reject(new Error("Exercise not found"))
    return Promise.resolve(exerciseFromRow(row, row.id, getState().indexes))
  },
  deleteExercise(id: number): Promise<void> {
    M.deleteExercise(id)
    return Promise.resolve()
  },
  exerciseHistory(id: number): Promise<ExerciseHistoryDay[]> {
    return Promise.resolve(Q.getExerciseHistoryQ(id))
  },

  // workouts
  listWorkouts(params?: {
    date?: string
    month?: string
  }): Promise<Workout[]> {
    return Promise.resolve(Q.listWorkoutsQ(params))
  },
  getWorkout(id: number): Promise<Workout> {
    const w = Q.getWorkoutQ(id)
    if (!w) return Promise.reject(new Error("Workout not found"))
    return Promise.resolve(w)
  },
  createWorkout(date: string): Promise<Workout> {
    const { row, merged_into_finished } = M.createWorkout(date)
    const w = Q.getWorkoutQ(row.id)!
    return Promise.resolve({ ...w, merged_into_finished })
  },
  patchWorkout(
    id: number,
    patch: Partial<
      Pick<Workout, "notes" | "started_at" | "finished_at" | "gym" | "status">
    >
  ): Promise<Workout> {
    M.patchWorkout(id, patch)
    const w = Q.getWorkoutQ(id)
    if (!w) return Promise.reject(new Error("Workout not found"))
    return Promise.resolve(w)
  },

  // workout exercises
  addExerciseToWorkout(
    workoutId: number,
    exerciseId: number
  ): Promise<WorkoutExercise> {
    const row = M.addExerciseToWorkout(workoutId, exerciseId)
    return Promise.resolve(weFromRow(row, getState().indexes))
  },
  removeExerciseFromWorkout(workoutId: number, weId: number): Promise<void> {
    M.removeExerciseFromWorkout(workoutId, weId)
    return Promise.resolve()
  },
  copyFromWorkout(
    targetId: number,
    sourceId: number,
    withSets = false
  ): Promise<Workout> {
    M.copyFromWorkout(targetId, sourceId, withSets)
    const w = Q.getWorkoutQ(targetId)
    if (!w) return Promise.reject(new Error("Workout not found"))
    return Promise.resolve(w)
  },

  // sets
  addSet(weId: number, set: M.AddSetInput): Promise<WorkoutSet> {
    const row = M.addSet(weId, set)
    return Promise.resolve(setFromRow(row))
  },
  addPlannedSet(weId: number, set: M.AddSetInput): Promise<WorkoutSet> {
    const row = M.addSet(weId, { ...set, is_planned: true })
    return Promise.resolve(setFromRow(row))
  },
  updateSet(
    setId: number,
    patch: { weight?: number; reps?: number; note?: string; created_at?: string }
  ): Promise<WorkoutSet> {
    const row = M.updateSet(setId, patch)
    if (!row) return Promise.reject(new Error("Set not found"))
    return Promise.resolve(setFromRow(row))
  },
  deleteSet(setId: number): Promise<void> {
    M.deleteSet(setId)
    return Promise.resolve()
  },

  // gyms
  listGyms(): Promise<Gym[]> {
    return Promise.resolve(Q.listGymsQ())
  },
  createGym(name: string): Promise<Gym> {
    const row = M.createGym(name)
    return Promise.resolve({ id: row.id, name: row.name })
  },
  deleteGym(id: number): Promise<void> {
    M.deleteGym(id)
    return Promise.resolve()
  },
  renameGym(id: number, name: string): Promise<Gym | null> {
    const row = M.renameGym(id, name)
    return Promise.resolve(row ? { id: row.id, name: row.name } : null)
  },

  // calendar
  getCalendar(year: number, month: number): Promise<CalendarMap> {
    return Promise.resolve(Q.getCalendarQ(year, month))
  },

  // prs
  recomputePrs(): Promise<{ recomputed: number }> {
    return Promise.resolve(M.recomputeAllPrs())
  },
}
