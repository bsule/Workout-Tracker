"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import { RestoreBackupScreen } from "@/components/sync/RestoreBackupScreen"
import {
  configureStore,
  hydrateStore,
  useHydrated,
  useStore,
} from "@/lib/store"
import { unloadWebStore, waitForWebUnload } from "@/lib/store/session"
import { installWebStore } from "@/lib/store/setupWebStore"
import { useIsClient } from "@/lib/useIsClient"
import { adoptLegacyWebStore } from "@/lib/store/storage"
import { accountStorePath, legacyStorePath } from "@lift/core/store/paths"
import { autoSync, SnapshotTooNewError } from "@lift/core"
import {
  WEB_ENGINE_ENABLED,
  getWebSessions,
  unloadWebSessions,
  webEngineErrorMessage,
} from "@/lib/engine/webEngine"
import {
  EngineProvider,
  type EngineContextValue,
} from "@lift/engine-client/react"
import type { AccountEngineSession } from "@lift/engine-client/session"

interface Props {
  children: React.ReactNode
}

export function StoreProvider({ children }: Props) {
  const { user, loading } = useAuth()
  // Signed out, the app shows only the landing, login and signup pages, which
  // read nothing from the store. Loading one anyway made an empty users/anon
  // store in the browser (mobile StoreProvider does the same).
  // Keyed by user id, not username: renaming the account in Settings must
  // keep the same store.
  const userKey = user ? String(user.id) : null
  // The username only locates a store an older build kept under it. Kept in a
  // ref so a rename does not reload the store; set in an effect declared
  // before the load effect below, so it is current when that one runs.
  const username = useRef<string | null>(null)
  useEffect(() => {
    username.current = user?.username ?? null
  })
  const hydrated = useHydrated()
  const isClient = useIsClient()
  const storeEmpty = useStore((s) => isStoreEmpty(s.snapshot))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [engineSession, setEngineSession] = useState<AccountEngineSession | null>(null)
  // "Start fresh" on the restore prompt holds for this account until the page
  // reloads, like mobile holds it until the app restarts.
  const [restoreDismissedFor, setRestoreDismissedFor] = useState<string | null>(null)
  const loadedKey = useRef<string | null>(null)

  // A different account (or none): forget the last one's loaded key and load
  // error while rendering, so nothing of theirs shows for a frame.
  const [keyFor, setKeyFor] = useState(userKey)
  if (keyFor !== userKey) {
    setKeyFor(userKey)
    setLoadError(null)
    if (userKey == null) {
      setActiveKey(null)
      setEngineSession(null)
    }
  }

  useEffect(() => {
    if (loading) return
    installWebStore()
    if (userKey == null) {
      // Signed out: keep nothing in memory for the next user to see, or for
      // a flush or auto sync to write under their account.
      loadedKey.current = null
      setEngineSession(null)
      if (WEB_ENGINE_ENABLED) void unloadWebSessions()
      else void unloadWebStore()
      return
    }
    let cancelled = false

    async function init(key: string) {
      try {
        if (WEB_ENGINE_ENABLED) {
          if (loadedKey.current && loadedKey.current !== key) {
            loadedKey.current = null
            setEngineSession(null)
            await unloadWebSessions()
          }
          if (cancelled) return
          const subPath = accountStorePath(Number(key))
          const name = username.current
          if (name) await adoptLegacyWebStore(legacyStorePath(name), subPath)
          if (cancelled) return

          const sessions = getWebSessions()
          await sessions.switchAccount(key)
          const state = sessions.getSnapshot()
          if (state.status === "error") {
            throw state.error
          }
          if (state.status !== "ready") return
          if (cancelled) return
          loadedKey.current = key
          setEngineSession(state.session)
          setActiveKey(key)
          scheduleAutoSync()
          return
        }

        // Save and drop the outgoing user before the incoming one loads.
        if (loadedKey.current && loadedKey.current !== key) {
          loadedKey.current = null
          await unloadWebStore()
        } else {
          await waitForWebUnload()
        }
        if (cancelled) return
        const subPath = accountStorePath(Number(key))
        const name = username.current
        if (name) await adoptLegacyWebStore(legacyStorePath(name), subPath)
        if (cancelled) return
        configureStore(subPath)
        await hydrateStore()
        if (cancelled) return
        loadedKey.current = key
        setActiveKey(key)
        scheduleAutoSync()
      } catch (e) {
        console.error("Local store bootstrap failed:", e)
        if (cancelled) return
        setLoadError(
          WEB_ENGINE_ENABLED
            ? (webEngineErrorMessage({ status: "error", accountKey: key, error: e as Error }) ?? "Your data could not be loaded. Reload the page to try again.")
            : e instanceof SnapshotTooNewError
              ? "Your data was saved by a newer version of Lift. Reload the page to get the latest version and open it. Nothing was changed."
              : "Your data could not be loaded. Reload the page to try again."
        )
      }
    }

    void init(userKey)

    return () => {
      cancelled = true
      cancelAutoSync()
    }
  }, [loading, userKey])

  // StoreOwner holds the browser-wide editor lock throughout this provider's
  // lifetime. Waiting tabs hydrate from disk only after the previous owner saves.

  // Signed out: the pages render without a store. Only after hydration:
  // the server has no localStorage, so it always sees "signed out", and
  // rendering the page there while the browser (signed in) renders the loader
  // failed hydration on every signed-in page. Both render the loader first.
  if (isClient && !loading && userKey == null) {
    return <>{children}</>
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="max-w-sm text-center text-base leading-relaxed text-foreground">
          {loadError}
        </p>
      </div>
    )
  }

  const isReady = WEB_ENGINE_ENABLED
    ? engineSession != null && activeKey === userKey
    : hydrated && activeKey === userKey

  if (loading || !isReady) {
    return <FullPageLoader />
  }

  // Empty store and not dismissed: offer to pull from cloud sync.
  const content = (
    <div key={activeKey}>
      {restoreDismissedFor !== userKey && storeEmpty ? (
        <RestoreBackupScreen onDismiss={() => setRestoreDismissedFor(userKey)} />
      ) : (
        children
      )}
    </div>
  )

  if (WEB_ENGINE_ENABLED && engineSession) {
    const value: EngineContextValue = {
      session: engineSession,
      client: engineSession.client,
      api: engineSession.api,
      data: engineSession.data,
    }
    return <EngineProvider value={value}>{content}</EngineProvider>
  }

  return content
}

function isStoreEmpty(snapshot: {
  workouts: unknown[]
  exercises: { is_deleted?: boolean }[]
}): boolean {
  if (snapshot.workouts.length > 0) return false
  return snapshot.exercises.every((e) => e.is_deleted)
}

/**
 * Push if this device hasn't synced in a day. Runs after hydrate. Deferred to browser idle so serialize()
 * (JSON.stringify + gzip, both synchronous) can't stall a paint. When not due
 * it is one comparison; offline, signed out, or unhydrated it does nothing.
 * See autoSync.maybeAutoSync().
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
