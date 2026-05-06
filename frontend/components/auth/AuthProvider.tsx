"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { api, getToken, setToken } from "@/lib/api"
import type { User } from "@/types"

interface AuthState {
  user: User | null
  loading: boolean
  signup: (input: {
    username: string
    email: string
    password: string
  }) => Promise<void>
  login: (input: { username: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // Lazy init so SSR renders without a flash; client refines once mounted.
  const [loading, setLoading] = useState(
    () => typeof window !== "undefined" && getToken() !== null
  )

  useEffect(() => {
    if (!getToken()) return
    api
      .me()
      .then(setUser)
      .catch(() => {
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const signup = useCallback(
    async (input: { username: string; email: string; password: string }) => {
      const res = await api.signup(input)
      setToken(res.token)
      setUser(res.user)
    },
    []
  )

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      const res = await api.login(input)
      setToken(res.token)
      setUser(res.user)
    },
    []
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // ignore — clear local state regardless
    }
    setToken(null)
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!getToken()) return
    const u = await api.me()
    setUser(u)
  }, [])

  return (
    <AuthContext value={{ user, loading, signup, login, logout, refreshUser }}>
      {children}
    </AuthContext>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
