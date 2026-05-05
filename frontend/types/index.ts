export type Category =
  | "abs"
  | "back"
  | "biceps"
  | "cardio"
  | "chest"
  | "legs"
  | "shoulders"
  | "triceps"

export const CATEGORIES: Category[] = [
  "abs",
  "back",
  "biceps",
  "cardio",
  "chest",
  "legs",
  "shoulders",
  "triceps",
]

export interface Exercise {
  id: number
  name: string
  category: Category
  is_custom: boolean
  workouts_count?: number
  last_performed_days_ago?: number | null
}

export interface WorkoutSet {
  id: number
  weight: number
  reps: number
  is_pr: boolean
  was_pr: boolean
  note: string
  order: number
}

export interface WorkoutExercise {
  id: number
  exercise: Exercise
  order: number
  sets: WorkoutSet[]
}

export interface Workout {
  id: number
  date: string
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  notes: string
  exercises: WorkoutExercise[]
  created_at: string
}

export type CalendarMap = Record<string, Category[]>

export interface HistorySet {
  id: number
  weight: number
  reps: number
  is_pr: boolean
  was_pr: boolean
  note: string
  order: number
  estimated_one_rm: number
}

export interface ExerciseHistoryDay {
  date: string
  sets: HistorySet[]
}

export interface User {
  id: number
  username: string
  email: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface CsvPreviewResponse {
  headers: string[]
  rows: Record<string, string>[]
  row_count: number
  inferred_date_format: string | null
}

export interface CsvImportResponse {
  imported: number
  exercises_created: string[]
  errors: { row: number; message: string }[]
}

export interface CsvMapping {
  date_col: string
  exercise_col: string
  weight_col: string
  reps_col: string
  category_col?: string
  default_category?: Category
  date_format?: string
}
