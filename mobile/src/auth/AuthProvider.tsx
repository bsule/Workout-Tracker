import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { User } from "@lift/core"
import { CloudflareTransport, sync as syncModule } from "@lift/core"
import Constants from "expo-constants"
import {
  api,
  getToken,
  setToken,
  getCachedUser,
  setCachedUser,
  ApiError,
} from "./api"

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:8787/api"

const ETAG_KEY = "lift.sync.etag"

const syncTransport = new CloudflareTransport({
  apiBase: API_BASE,
  getToken,
  onEtagChange: (etag) => {
    if (etag) {
      AsyncStorage.setItem(ETAG_KEY, etag).catch(() => {})
    } else {
      AsyncStorage.removeItem(ETAG_KEY).catch(() => {})
    }
  },
})

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
      const savedEtag = await AsyncStorage.getItem(ETAG_KEY).catch(() => null)
      if (savedEtag) syncTransport.setEtag(savedEtag)
      syncModule.configureSync(syncTransport)

      // Tokens never expire server-side, so a stored token is a valid session.
      // Render from cache first; waiting on /auth/me means no network, no app.
      const cached = await getCachedUser()
      if (cached && !cancelled) {
        setUser(cached)
        setLoading(false)
      }

      try {
        const me = await api.me()
        if (!cancelled) setUser(me)
        await setCachedUser(me)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Genuinely revoked or deleted — drop the whole local session.
          await setToken(null)
          await setCachedUser(null)
          if (!cancelled) setUser(null)
          syncModule.configureSync(null)
        }
        // Network / 5xx: keep the cached session exactly as it is.
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
    await setCachedUser(res.user)
    setUser(res.user)
    syncTransport.setEtag(null)
    syncModule.configureSync(syncTransport)
  }, [])

  const signup = useCallback(
    async (payload: { username: string; email: string; password: string }) => {
      const res = await api.signup(payload)
      await setToken(res.token)
      await setCachedUser(res.user)
      setUser(res.user)
      syncTransport.setEtag(null)
      syncModule.configureSync(syncTransport)
    },
    []
  )

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "username" | "email">>) => {
      const updated = await api.updateProfile(patch)
      await setCachedUser(updated)
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
    await setCachedUser(null)
    setUser(null)
    syncTransport.setEtag(null)
    syncModule.configureSync(null)
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
