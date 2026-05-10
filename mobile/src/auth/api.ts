/**
 * Mobile auth client. Mirrors frontend/lib/api.ts shape but uses AsyncStorage
 * for the token and Constants for the API base URL. Network calls are limited
 * to /auth/* — workout/exercise/set/gym data is local-first via @lift/core.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import Constants from "expo-constants"
import type { AuthResponse, User } from "@lift/core"

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:8787/api"

const TOKEN_KEY = "lift.token"

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY)
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token)
  else await AsyncStorage.removeItem(TOKEN_KEY)
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
  const token = await getToken()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (token) headers.set("Authorization", `Token ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 204) return undefined as T

  const contentType = res.headers.get("content-type") ?? ""
  const body: unknown = contentType.includes("application/json")
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    const message =
      typeof body === "object" && body
        ? extractErrorMessage(body as Record<string, unknown>)
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
  updateProfile(patch: Partial<Pick<User, "username" | "email">>) {
    return request<User>("/auth/me/", {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  },
}
