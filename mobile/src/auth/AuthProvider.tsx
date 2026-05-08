import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { User } from "@lift/core"
import { api, getToken, setToken, ApiError } from "./api"

interface AuthState {
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

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const me = await api.me()
        if (!cancelled) setUser(me)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await setToken(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login({ username, password })
    await setToken(res.token)
    setUser(res.user)
  }, [])

  const signup = useCallback(
    async (payload: { username: string; email: string; password: string }) => {
      const res = await api.signup(payload)
      await setToken(res.token)
      setUser(res.user)
    },
    []
  )

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "username" | "email">>) => {
      const updated = await api.updateProfile(patch)
      setUser(updated)
    },
    []
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // best-effort; we still clear local token
    }
    await setToken(null)
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, signup, logout, updateProfile }),
    [user, loading, login, signup, logout, updateProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error("useAuth must be inside AuthProvider")
  return v
}
