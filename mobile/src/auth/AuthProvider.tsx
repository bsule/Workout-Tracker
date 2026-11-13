import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { User } from "@lift/core"
import { clearSyncClock, configureSyncClock } from "@lift/core/sync/syncClock"
import { rnSyncClockStore } from "../sync/clockStore"
import { clearLegacyEtag } from "../sync/deviceId"
import { configureEngineSync } from "../sync/engineSync"
import {
  api,
  getToken,
  setToken,
  getCachedUser,
  setCachedUser,
  ApiError,
} from "./api"

import { AuthContext, type AuthState } from "./AuthContext"
export { useAuth } from "./AuthContext"

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
      // The engine keeps the sync etag. A legacy one under lift.sync.etag is
      // read once, by the open that migrates an older store.
      configureSyncClock(rnSyncClockStore)
      configureEngineSync(token)

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
          configureEngineSync(null)
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
    // A legacy etag on this device belongs to whoever was signed in before.
    clearLegacyEtag()
    configureSyncClock(rnSyncClockStore)
    clearSyncClock()
    configureEngineSync(res.token)
  }, [])

  const signup = useCallback(
    async (payload: { username: string; email: string; password: string }) => {
      const res = await api.signup(payload)
      await setToken(res.token)
      await setCachedUser(res.user)
      setUser(res.user)
      clearLegacyEtag()
      configureSyncClock(rnSyncClockStore)
      clearSyncClock()
      configureEngineSync(res.token)
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
    clearLegacyEtag()
    clearSyncClock()
    configureSyncClock(null)
    configureEngineSync(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, signup, logout, updateProfile }),
    [user, loading, login, signup, logout, updateProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
