import { createContext, useContext } from "react"
import type { User } from "@lift/core"

// Keep context identity stable when Fast Refresh replaces the provider.
export interface AuthState {
  user: User | null
  loading: boolean
  login(username: string, password: string): Promise<void>
  signup(payload: {
    username: string
    email: string
    password: string
  }): Promise<void>
  logout(): Promise<void>
  updateProfile(patch: Partial<Pick<User, "username" | "email">>): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error("useAuth must be inside AuthProvider")
  return v
}
