"use client"

import { useEffect, useState, type ReactNode } from "react"
import { sync } from "@lift/core"
import { useAuth, refreshWebSync } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import { useIsClient } from "@/lib/useIsClient"
import { unloadWebStore } from "@/lib/store/session"
import { getToken } from "@/lib/api"
import { WEB_ENGINE_ENABLED, unloadWebSessions } from "@/lib/engine/webEngine"

/** A lifetime lock, acquired before hydration and released after the final save.
 * Waiting tabs never load stale snapshots or start sync. The browser releases
 * the lock on a crash/close, so no timeout can grant two tabs ownership. */
export function StoreOwner({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const mounted = useIsClient()
  const key = user ? String(user.id) : null
  const [ownedKey, setOwnedKey] = useState<string | null>(null)
  const [sessionChanged, setSessionChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading || !key || sessionChanged) return
    const controller = new AbortController()
    let release: (() => void) | undefined
    const token = getToken()
    if (!navigator.locks) return
    void navigator.locks.request("lift:store-editor", { signal: controller.signal }, async () => {
      if (controller.signal.aborted) return
      // Auth/sync were initialized before waiting; read them afresh on takeover.
      if (getToken() !== token) {
        setSessionChanged(true)
        return
      }
      refreshWebSync()
      setOwnedKey(key)
      await new Promise<void>((resolve) => { release = resolve })
      await unloadWebStore()
      if (WEB_ENGINE_ENABLED) await unloadWebSessions()
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not open browser storage.")
    })
    return () => {
      controller.abort()
      setOwnedKey(null)
      release?.()
    }
  }, [key, loading, sessionChanged])

  useEffect(() => {
    const token = getToken()
    const changed = (e: StorageEvent) => {
      if ((e.key === "lift.token" || e.key === null) && getToken() !== token) {
        sync.configureSync(null)
        setSessionChanged(true)
      }
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [key])

  if (!mounted) return <FullPageLoader />

  if (!sessionChanged && (loading || !key || ownedKey === key)) return children

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="max-w-sm space-y-3 text-center" role="status">
        <h1 className="text-lg font-semibold">{sessionChanged ? "Your account changed in another tab" : "Open Lift in one tab"}</h1>
        <p className="text-sm text-muted-foreground">
          {error ?? (sessionChanged
            ? "Reload to continue with the current account."
            : typeof navigator !== "undefined" && !navigator.locks
              ? "This browser cannot safely coordinate workout storage. Open Lift in a current browser."
              : "Lift is already open in another tab. Close that tab to continue here with your latest saved workouts.")}
        </p>
        {sessionChanged && <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => window.location.reload()}>Reload</button>}
      </div>
    </div>
  )
}
