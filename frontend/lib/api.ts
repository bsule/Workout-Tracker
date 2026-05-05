import type {
  AuthResponse,
  User,
  WorkoutSession,
  WorkoutSet,
  WorkoutSplit,
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
  if (init.body && !headers.has("Content-Type")) {
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

export const api = {
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
  listWorkouts() {
    return request<WorkoutSplit[]>("/workouts/")
  },
  getWorkout(id: number) {
    return request<WorkoutSplit>(`/workouts/${id}/`)
  },
  createWorkout(name: string) {
    return request<WorkoutSplit>("/workouts/", {
      method: "POST",
      body: JSON.stringify({ name }),
    })
  },
  deleteWorkout(id: number) {
    return request<void>(`/workouts/${id}/`, { method: "DELETE" })
  },
  createSession(splitId: number) {
    return request<WorkoutSession>(`/workouts/${splitId}/sessions/`, {
      method: "POST",
    })
  },
  deleteSession(sessionId: number) {
    return request<void>(`/sessions/${sessionId}/`, { method: "DELETE" })
  },
  addSet(sessionId: number, set: { weight: number; reps: number }) {
    return request<WorkoutSet>(`/sessions/${sessionId}/sets/`, {
      method: "POST",
      body: JSON.stringify(set),
    })
  },
  calculator(payload: { weight: number; reps: number }) {
    return request<{ one_rep_max: number }>("/calculator/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },
}
