"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import {
  configureStore,
  hydrateStore,
  unloadStore,
  useHydrated,
} from "@/lib/store"
import { installWebStore } from "@/lib/store/setupWebStore"
import { autoSync } from "@lift/core"

interface Props {
  children: React.ReactNode
}

export function StoreProvider({ children }: Props) {
  const { user, loading } = useAuth()
  const userKey = user?.username ?? "anon"
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const hydrated = useHydrated()

  useEffect(() => {
    if (loading) return
    let cancelled = false
    installWebStore()

    async function init() {
      try {
        if (activeKey && activeKey !== userKey) {
          await unloadStore()
        }
        if (cancelled) return
        configureStore(`users/${userKey}`)
        await hydrateStore()
        if (cancelled) return
        setActiveKey(userKey)
        // "anon" is the signed-out namespace; maybeAutoSync also no-ops
        // without a configured transport.
        if (userKey !== "anon") scheduleAutoSync()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }

    void init()

    return () => {
      cancelled = true
      cancelAutoSync()
    }
  }, [loading, userKey, activeKey])

  if (error) {
    console.error("Local store error:", error)
  }

  if (loading || !hydrated || activeKey !== userKey) {
    return <FullPageLoader />
  }

  // Remount children whenever the active user changes so per-page effects
  // re-fetch against the freshly hydrated snapshot. Without this, components
  // mounted under "anon" (during the brief window before AuthProvider resolves
  // /auth/me) keep stale state when the real user's snapshot swaps in.
  return <div key={activeKey}>{children}</div>
}

/**
 * Once-per-load check: push if this device hasn't synced in a day.
 * Deferred to browser idle so serialize() (JSON.stringify + gzip, both
 * synchronous) can't stall the first paint. A no-op when not due, offline,
 * or signed out — see autoSync.maybeAutoSync().
 */
let cancelPendingAutoSync: (() => void) | null = null

function scheduleAutoSync() {
  cancelAutoSync()
  const run = () => {
    cancelPendingAutoSync = null
    void autoSync.maybeAutoSync()
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 5000 })
    cancelPendingAutoSync = () => window.cancelIdleCallback(id)
  } else {
    const id = window.setTimeout(run, 3000)
    cancelPendingAutoSync = () => window.clearTimeout(id)
  }
}

function cancelAutoSync() {
  cancelPendingAutoSync?.()
  cancelPendingAutoSync = null
}
