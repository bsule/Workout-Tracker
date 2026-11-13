"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
import {
  CloudflareTransport,
  clearSyncClock,
  configureSyncClock,
  createDeviceIdSource,
  sync as syncModule,
} from "@lift/core"
import {
  readStoredEtag,
  webDeviceIdStore,
  webSyncClockStore,
  writeStoredEtag,
} from "@/lib/syncStorage"
import { unloadWebStore } from "@/lib/store/session"
import { clearMark } from "@/lib/restTimerMark"

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787/api"

let syncTransport: CloudflareTransport | null = null

/** Each transport owns one credential and cannot adopt late replies after logout. */
function configureWebSync() {
  const token = getToken()
  syncTransport = token ? new CloudflareTransport({
    apiBase: API_BASE,
    getToken: () => token,
    onEtagChange: writeStoredEtag,
    getDeviceId: createDeviceIdSource(webDeviceIdStore),
  }) : null
  syncTransport?.setEtag(readStoredEtag())
  syncModule.configureSync(syncTransport)
}

/** Point the core's sync clock at localStorage. Idempotent. */
function installSyncClock() {
  configureSyncClock(webSyncClockStore)
}

/** Re-read sync metadata only after this tab becomes the sole store editor. */
export function refreshWebSync() {
  installSyncClock()
  configureWebSync()
}

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

  const authRequest = useRef(0)

  useEffect(() => {
    const request = ++authRequest.current
    const token = getToken()
    if (!token) return
    let cancelled = false
    const current = () => !cancelled && request === authRequest.current && getToken() === token
    installSyncClock()
    configureWebSync()
    api
      .me()
      .then((u) => {
        if (!current()) return
        setUser(u)
        setCachedUser(u)
      })
      .catch((e) => {
        if (!current()) return
        // Tokens never expire server-side, so only a 401 means truly revoked.
        // Clearing on a 5xx or offline fetch logged users out for our own bug.
        if (e instanceof ApiError && e.status === 401) {
          setToken(null)
          setCachedUser(null)
          setUser(null)
          setLoading(false)
          syncModule.configureSync(null)
        }
      })
      .finally(() => { if (current()) setLoading(false) })
    // This ref is a request counter, not a DOM node. Invalidate every pending
    // auth handler on unmount, including ones started after this effect.
    return () => {
      cancelled = true
      // eslint-disable-next-line react-hooks/exhaustive-deps
      authRequest.current++
    }
  }, [])

  const signup = useCallback(
    async (input: { username: string; email: string; password: string }) => {
      const request = ++authRequest.current
      const res = await api.signup(input)
      if (request !== authRequest.current) return
      setToken(res.token)
      setUser(res.user)
      setCachedUser(res.user)
      setLoading(false)
      writeStoredEtag(null)
      installSyncClock()
      clearSyncClock()
      configureWebSync()
    },
    []
  )

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      const request = ++authRequest.current
      const res = await api.login(input)
      if (request !== authRequest.current) return
      setToken(res.token)
      setUser(res.user)
      setCachedUser(res.user)
      setLoading(false)
      writeStoredEtag(null)
      installSyncClock()
      clearSyncClock()
      configureWebSync()
    },
    []
  )

  const logout = useCallback(async () => {
    const request = ++authRequest.current
    syncModule.configureSync(null)
    // A reset or stop of the signed-out user's rest ticker must not carry
    // over to the next account (mobile's unloadForSignOut does the same).
    clearMark()
    try {
      await unloadWebStore()
    } catch (e) {
      console.error("Failed to unload store on logout:", e)
    }
    if (request !== authRequest.current) return
    try {
      await api.logout()
    } catch {
      // ignore — clear local state regardless
    }
    if (request !== authRequest.current) return
    setToken(null)
    setUser(null)
    setLoading(false)
    setCachedUser(null)
    writeStoredEtag(null)
    clearSyncClock()
    configureSyncClock(null)
    syncModule.configureSync(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const request = ++authRequest.current
    const u = await api.me()
    if (request !== authRequest.current || getToken() !== token) return
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
