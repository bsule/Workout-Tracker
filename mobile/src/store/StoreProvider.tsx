import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import {
  EngineProvider,
  useEngineQuery,
  type EngineContextValue,
  type EngineCounts,
} from "@lift/engine-client/react"
import type { AccountEngineSession } from "@lift/engine-client/session"
import { engineErrorCode } from "../../modules/lift-engine"
import { useAuth } from "../auth/AuthProvider"
import { theme } from "../theme/theme"
import { OpenSupersededError, openForUser, unloadForSignOut } from "./bootstrap"
import { EngineErrorBoundary } from "./EngineErrorBoundary"

// Lazy so the screen and its components (Card, Button) do not create
// their StyleSheets at app load. App.tsx imports this file before it
// applies the stored theme mode, so an eager import froze those styles
// in the dark palette even when the user picked light.
const RestoreBackupScreen = lazy(() =>
  import("../screens/RestoreBackupScreen").then((m) => ({
    default: m.RestoreBackupScreen,
  }))
)

const TOO_NEW_MESSAGE =
  "Your data was saved by a newer version of Lift. Install the latest version to open it. Nothing was changed."
const LOAD_FAILED_MESSAGE = "Your data could not be loaded. Close and reopen the app to try again."

function loadErrorMessage(error: unknown): string {
  // Compared as a string so either an enum or string codes satisfy it.
  return String(engineErrorCode(error)) === "ERR_ENGINE_TOO_NEW" ? TOO_NEW_MESSAGE : LOAD_FAILED_MESSAGE
}

const COUNTS_QUERY = { kind: "counts" }

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  // Signed out, the app shows only the Login screen, which reads nothing from
  // the engine. Keyed by user id, not username: renaming the account in
  // Settings must keep the same store.
  const userKey = user ? String(user.id) : null
  // The username only locates a store an older build kept under it. Kept in a
  // ref so a rename does not reopen the store; set in an effect declared
  // before the load effect below, so it is current when that one runs.
  const username = useRef<string | null>(null)
  useEffect(() => {
    username.current = user?.username ?? null
  })
  const [session, setSession] = useState<AccountEngineSession | null>(null)
  const [restoreDismissedFor, setRestoreDismissedFor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped by "Try again" on a failed read: reopening gives a clean session.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (loading) return
    if (userKey == null) {
      // Signed out: keep nothing open for the next user to see, or for an
      // auto sync to push under their account.
      setSession(null)
      void unloadForSignOut()
      return
    }
    let cancelled = false
    setLoadError(null)
    setSession(null)
    openForUser({ id: Number(userKey), username: username.current ?? "" })
      .then((opened) => {
        if (!cancelled) setSession(opened)
      })
      .catch((e) => {
        if (cancelled || e instanceof OpenSupersededError) return
        console.error("Local store open failed:", e)
        setLoadError(loadErrorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [loading, userKey, attempt])

  if (!loading && userKey == null) {
    return <View style={{ flex: 1 }}>{children}</View>
  }

  if (loadError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: theme.spacing[6],
        }}
      >
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: theme.fontSize.base,
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          {loadError}
        </Text>
      </View>
    )
  }

  if (loading || !session || session.accountKey !== userKey) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    )
  }

  return (
    <OpenAccount
      key={`${session.accountKey}:${attempt}`}
      session={session}
      restoreDismissed={restoreDismissedFor === userKey}
      onDismissRestore={() => setRestoreDismissedFor(userKey)}
      onRetry={() => setAttempt((n) => n + 1)}
    >
      {children}
    </OpenAccount>
  )
}

function OpenAccount({
  session,
  restoreDismissed,
  onDismissRestore,
  onRetry,
  children,
}: {
  session: AccountEngineSession
  restoreDismissed: boolean
  onDismissRestore: () => void
  onRetry: () => void
  children: ReactNode
}) {
  const value = useMemo<EngineContextValue>(
    () => ({ session, client: session.client, api: session.api, data: session.data }),
    [session]
  )
  const counts = useEngineQuery<EngineCounts>(session.client, "counts", COUNTS_QUERY)
  // Same rule as before: no workouts and no exercises of your own. Read
  // before the first render (openForUser), so the prompt does not flash.
  const storeEmpty =
    counts.status === "ready" && counts.value.workouts === 0 && counts.value.exercises === 0

  // Empty store + user hasn't dismissed: offer to pull from cloud sync.
  if (!restoreDismissed && storeEmpty) {
    return (
      <EngineProvider value={value}>
        <View style={{ flex: 1 }}>
          <Suspense
            fallback={<View style={{ flex: 1, backgroundColor: theme.colors.background }} />}
          >
            <RestoreBackupScreen onDismiss={onDismissRestore} />
          </Suspense>
        </View>
      </EngineProvider>
    )
  }

  // Keyed by account in StoreProvider, so per-screen state starts fresh.
  return (
    <EngineProvider value={value}>
      <EngineErrorBoundary onRetry={onRetry}>
        <View style={{ flex: 1 }}>{children}</View>
      </EngineErrorBoundary>
    </EngineProvider>
  )
}
