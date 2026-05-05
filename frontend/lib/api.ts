import type {
  AuthResponse,
  CalendarMap,
  Category,
  CsvImportResponse,
  CsvMapping,
  CsvPreviewResponse,
  Exercise,
  ExerciseHistoryDay,
  User,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "@/types"

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8007/api"

const TOKEN_KEY = "lift.token"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
  else window.localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(status: number, message: string, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  const isForm =
    typeof FormData !== "undefined" && init.body instanceof FormData
  if (init.body && !isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (token) headers.set("Authorization", `Token ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 204) return undefined as T

  const contentType = res.headers.get("content-type") ?? ""
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    const message =
      typeof body === "object" && body
        ? extractErrorMessage(body)
        : String(body)
    throw new ApiError(res.status, message, body)
  }
  return body as T
}

function extractErrorMessage(body: Record<string, unknown>): string {
  if (typeof body.detail === "string") return body.detail
  for (const value of Object.values(body)) {
    if (Array.isArray(value) && typeof value[0] === "string") return value[0]
    if (typeof value === "string") return value
  }
  return "Request failed"
}

function qs(params: Record<string, string | number | undefined | null>) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  )
  if (!entries.length) return ""
  const usp = new URLSearchParams()
  for (const [k, v] of entries) usp.set(k, String(v))
  return `?${usp.toString()}`
}

export const api = {
  // ---------- auth ----------
  signup(payload: { username: string; email: string; password: string }) {
    return request<AuthResponse>("/auth/signup/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
  login(payload: { username: string; password: string }) {
    return request<AuthResponse>("/auth/login/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
  logout() {
    return request<void>("/auth/logout/", { method: "POST" })
  },
  me() {
    return request<User>("/auth/me/")
  },

  // ---------- exercises ----------
  listExercises(params?: {
    category?: Category
    q?: string
    sort?: "name" | "last_performed"
  }) {
    return request<Exercise[]>(`/exercises/${qs({ ...params })}`)
  },
  createExercise(body: { name: string; category: Category }) {
    return request<Exercise>("/exercises/", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },
  deleteExercise(id: number) {
    return request<void>(`/exercises/${id}/`, { method: "DELETE" })
  },
  exerciseHistory(id: number) {
    return request<ExerciseHistoryDay[]>(`/exercises/${id}/history/`)
  },

  // ---------- workouts ----------
  listWorkouts(params?: { date?: string; month?: string }) {
    return request<Workout[]>(`/workouts/${qs({ ...params })}`)
  },
  getWorkout(id: number) {
    return request<Workout>(`/workouts/${id}/`)
  },
  async getWorkoutByDate(date: string): Promise<Workout | null> {
    try {
      return await request<Workout>(`/workouts/by-date/${date}/`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  createWorkout(date: string) {
    return request<Workout>("/workouts/", {
      method: "POST",
      body: JSON.stringify({ date }),
    })
  },
  deleteWorkout(id: number) {
    return request<void>(`/workouts/${id}/`, { method: "DELETE" })
  },
  patchWorkout(
    id: number,
    patch: Partial<Pick<Workout, "notes" | "started_at" | "finished_at">>
  ) {
    return request<Workout>(`/workouts/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  },
  addExerciseToWorkout(workoutId: number, exerciseId: number) {
    return request<WorkoutExercise>(`/workouts/${workoutId}/exercises/`, {
      method: "POST",
      body: JSON.stringify({ exercise_id: exerciseId }),
    })
  },
  removeExerciseFromWorkout(workoutId: number, weId: number) {
    return request<void>(`/workouts/${workoutId}/exercises/${weId}/`, {
      method: "DELETE",
    })
  },
  copyFromWorkout(targetId: number, sourceId: number, withSets = false) {
    return request<Workout>(
      `/workouts/${targetId}/copy-from/${sourceId}/${qs({ with_sets: withSets ? 1 : 0 })}`,
      { method: "POST" }
    )
  },

  // ---------- sets ----------
  addSet(weId: number, set: { weight: number; reps: number; note?: string }) {
    return request<WorkoutSet>(`/workout-exercises/${weId}/sets/`, {
      method: "POST",
      body: JSON.stringify(set),
    })
  },
  updateSet(
    setId: number,
    patch: { weight?: number; reps?: number; note?: string }
  ) {
    return request<WorkoutSet>(`/sets/${setId}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  },
  deleteSet(setId: number) {
    return request<void>(`/sets/${setId}/`, { method: "DELETE" })
  },

  // ---------- calendar ----------
  getCalendar(year: number, month: number) {
    return request<CalendarMap>(`/calendar/${qs({ year, month })}`)
  },

  // ---------- csv ----------
  csvPreview(file: File) {
    const fd = new FormData()
    fd.append("file", file)
    return request<CsvPreviewResponse>("/csv/preview/", {
      method: "POST",
      body: fd,
    })
  },
  csvImport(file: File, mapping: CsvMapping) {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("mapping", JSON.stringify(mapping))
    return request<CsvImportResponse>("/csv/import/", {
      method: "POST",
      body: fd,
    })
  },

  // ---------- calculator ----------
  calculator(payload: { weight: number; reps: number }) {
    return request<{ one_rep_max: number }>("/calculator/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}
