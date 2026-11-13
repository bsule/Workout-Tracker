import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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

  const authRequest = useRef(0)

  useEffect(() => {
    const request = ++authRequest.current
    let cancelled = false
    const current = () => !cancelled && request === authRequest.current
    ;(async () => {
      const token = await getToken()
      if (!current()) return
      if (!token) {
        if (current()) setLoading(false)
        return
      }
      // The engine keeps the sync etag. A legacy one under lift.sync.etag is
      // read once, by the open that migrates an older store.
      configureSyncClock(rnSyncClockStore)
      configureEngineSync(token)

      // Tokens never expire server-side, so a stored token is a valid session.
      // Render from cache first; waiting on /auth/me means no network, no app.
      const cached = await getCachedUser()
      if (!current()) return
      if (cached && current()) {
        setUser(cached)
        setLoading(false)
      }

      try {
        const me = await api.me()
        if (!current()) return
        await setCachedUser(me)
        if (current()) setUser(me)
      } catch (e) {
        if (!current()) return
        if (e instanceof ApiError && e.status === 401) {
          // Genuinely revoked or deleted — drop the whole local session.
          await setToken(null)
          if (!current()) return
          await setCachedUser(null)
          if (!current()) return
          if (current()) setUser(null)
          configureEngineSync(null)
        }
        // Network / 5xx: keep the cached session exactly as it is.
      } finally {
        if (current()) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      authRequest.current++
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const request = ++authRequest.current
    const res = await api.login({ username, password })
    if (request !== authRequest.current) return
    await setToken(res.token)
    if (request !== authRequest.current) return
    await setCachedUser(res.user)
    if (request !== authRequest.current) return
    setUser(res.user)
    setLoading(false)
    // A legacy etag on this device belongs to whoever was signed in before.
    clearLegacyEtag()
    configureSyncClock(rnSyncClockStore)
    clearSyncClock()
    configureEngineSync(res.token)
  }, [])

  const signup = useCallback(
    async (payload: { username: string; email: string; password: string }) => {
      const request = ++authRequest.current
      const res = await api.signup(payload)
      if (request !== authRequest.current) return
      await setToken(res.token)
      if (request !== authRequest.current) return
      await setCachedUser(res.user)
      if (request !== authRequest.current) return
      setUser(res.user)
      setLoading(false)
      clearLegacyEtag()
      configureSyncClock(rnSyncClockStore)
      clearSyncClock()
      configureEngineSync(res.token)
    },
    []
  )

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "username" | "email">>) => {
      const request = ++authRequest.current
      const updated = await api.updateProfile(patch)
      if (request !== authRequest.current) return
      await setCachedUser(updated)
      if (request !== authRequest.current) return
      setUser(updated)
      setLoading(false)
    },
    []
  )

  const logout = useCallback(async () => {
    const request = ++authRequest.current
    configureEngineSync(null)
    try {
      await api.logout()
    } catch {
      // best-effort; we still clear local token
    }
    if (request !== authRequest.current) return
    await setToken(null)
    if (request !== authRequest.current) return
    await setCachedUser(null)
    if (request !== authRequest.current) return
    setUser(null)
    setLoading(false)
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
