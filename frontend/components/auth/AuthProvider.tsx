"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import {
  api,
  ApiError,
  getCachedUser,
  getToken,
  setCachedUser,
  setToken,
} from "@/lib/api"
import type { User } from "@/types"
import { CloudflareTransport, sync as syncModule } from "@lift/core"

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787/api"

const syncTransport = new CloudflareTransport({
  apiBase: API_BASE,
  getToken,
})

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
  // Lazy init so SSR renders without a flash; client refines once mounted.
  const [user, setUser] = useState<User | null>(() =>
    typeof window !== "undefined" && getToken() ? getCachedUser() : null
  )
  // Only block on the network with a token but no cached profile to render
  // from. On a cache hit we render now and revalidate in the background.
  const [loading, setLoading] = useState(
    () =>
      typeof window !== "undefined" &&
      getToken() !== null &&
      getCachedUser() === null
  )

  useEffect(() => {
    if (!getToken()) return
    syncModule.configureSync(syncTransport)
    api
      .me()
      .then((u) => {
        setUser(u)
        setCachedUser(u)
      })
      .catch((e) => {
        // Tokens never expire server-side, so only a 401 means truly revoked.
        // Clearing on a 5xx or offline fetch logged users out for our own bug.
        if (e instanceof ApiError && e.status === 401) {
          setToken(null)
          setCachedUser(null)
          setUser(null)
          syncModule.configureSync(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const signup = useCallback(
    async (input: { username: string; email: string; password: string }) => {
      const res = await api.signup(input)
      setToken(res.token)
      setUser(res.user)
      setCachedUser(res.user)
      syncTransport.setEtag(null)
      syncModule.configureSync(syncTransport)
    },
    []
  )

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      const res = await api.login(input)
      setToken(res.token)
      setUser(res.user)
      setCachedUser(res.user)
      syncTransport.setEtag(null)
      syncModule.configureSync(syncTransport)
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
    setCachedUser(null)
    syncTransport.setEtag(null)
    syncModule.configureSync(null)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!getToken()) return
    const u = await api.me()
    setUser(u)
    setCachedUser(u)
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
