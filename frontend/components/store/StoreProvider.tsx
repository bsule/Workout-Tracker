"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import {
  configureStore,
  hydrateStore,
  useHydrated,
} from "@/lib/store"

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
    configureStore(`users/${userKey}`)
    hydrateStore()
      .then(() => {
        if (!cancelled) setActiveKey(userKey)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [loading, userKey])

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
