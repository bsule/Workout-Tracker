/**
 * A category slug — lowercase letters/digits/hyphens. Built-in categories use
 * fixed slugs (e.g. "chest"), and users may add custom categories with
 * arbitrary slugs derived from a label.
 */
export type Category = string

export const DEFAULT_CATEGORIES: Category[] = [
  "abs",
  "back",
  "biceps",
  "cardio",
  "chest",
  "legs",
  "shoulders",
  "triceps",
]

/** @deprecated Prefer `useCategoryStyles().categories` so custom categories appear. */
export const CATEGORIES = DEFAULT_CATEGORIES

export type ExerciseKind =
  | "weight_reps"
  | "distance_time"
  | "bodyweight_reps"
  | "time_only"

export interface Exercise {
  id: number
  name: string
  category: Category
  kind: ExerciseKind
  is_custom: boolean
  workouts_count?: number
  last_performed_days_ago?: number | null
}

export interface WorkoutSet {
  id: number
  weight: number | null
  reps: number | null
  distance_m: number | null
  distance_unit_display: string
  time_seconds: number | null
  is_pr: boolean
  was_pr: boolean
  is_position_pr: boolean
  was_position_pr: boolean
  note: string
  order: number
  is_planned?: boolean
  /** ISO timestamp the set was logged (or last edited). Surfaced so callers
   *  can derive a workout's "end time" without a separate finishWorkout step. */
  created_at: string
}

export type WorkoutStatus = "planned" | "active" | "done"

export interface WorkoutExercise {
  id: number
  exercise: Exercise
  order: number
  sets: WorkoutSet[]
}

export interface Workout {
  id: number
  date: string
  status?: WorkoutStatus
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  gym: string
  notes: string
  exercises: WorkoutExercise[]
  created_at: string
  /** Server-only flag set on POST /workouts/ when the response reuses an
   *  already-finished workout for the same date (two-a-day cap). */
  merged_into_finished?: boolean
}

export type CalendarMap = Record<string, Category[]>

export interface HistorySet {
  id: number
  weight: number | null
  reps: number | null
  distance_m: number | null
  distance_unit_display: string
  time_seconds: number | null
  is_pr: boolean
  was_pr: boolean
  is_position_pr: boolean
  was_position_pr: boolean
  note: string
  order: number
  estimated_one_rm: number
}

export interface ExerciseHistoryDay {
  date: string
  sets: HistorySet[]
}

export interface UserSettings {
  weight_unit: "kg" | "lb"
  first_day_of_week: 0 | 1
  /** Optional UI flag: when true, the set logger shows estimated 1RM next to
   *  each logged set. Defaults to false when missing in older snapshots. */
  show_one_rm?: boolean
  /** Optional UI flag: when true (default), set lists render a "{n}PR" badge
   *  for sets that are PRs at their set position. When false, only overall
   *  exercise PRs render. */
  show_position_prs?: boolean
  /** Optional UI flag: when true (default), the log-set page shows time
   *  rested between sets next to each set number. */
  show_rest_time?: boolean
  /** Optional UI flag: when true (default), the log-set page shows a
   *  ticking "Xs since last set" label under the set list. Hides itself
   *  once 30 min have elapsed regardless of this setting. */
  show_time_since_last_set?: boolean
  /** The active AI provider used by the AI Plan screen. Defaults to
   *  "openai" when unset. The matching API key is stored separately in
   *  secure storage (see mobile/src/ai/keys.ts). */
  ai_provider?: AIProviderId
}

export type AIProviderId = "openai" | "anthropic" | "gemini" | "deepseek"

export interface User {
  id: number
  username: string
  email: string
}

export interface Gym {
  id: number | null
  name: string
}

export interface AuthResponse {
  token: string
  user: User
}
