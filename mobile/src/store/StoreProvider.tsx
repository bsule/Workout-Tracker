import { useEffect, useState, type ReactNode } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { SnapshotTooNewError, useHydrated, useStore } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { theme } from "../theme/theme"
import { RestoreBackupScreen } from "../screens/RestoreBackupScreen"
import { bootstrapForUser, unloadForSignOut } from "./bootstrap"

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  // Signed out, the app shows only the Login screen, which reads nothing from
  // the store. Loading one anyway made an empty users/anon store on disk.
  const userKey = user?.username ?? null
  const hydrated = useHydrated()
  const storeEmpty = useStore((s) => isStoreEmpty(s.snapshot))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [restoreDismissedFor, setRestoreDismissedFor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (userKey == null) {
      // Signed out: keep nothing in memory for the next user to see, or for
      // a flush or auto sync to write under their account.
      setActiveKey(null)
      void unloadForSignOut()
      return
    }
    let cancelled = false
    setLoadError(null)
    bootstrapForUser(userKey)
      .then(() => {
        if (!cancelled) setActiveKey(userKey)
      })
      .catch((e) => {
        console.error("Local store bootstrap failed:", e)
        if (cancelled) return
        setLoadError(
          e instanceof SnapshotTooNewError
            ? "Your data was saved by a newer version of Lift. Install the latest version to open it. Nothing was changed."
            : "Your data could not be loaded. Close and reopen the app to try again."
        )
      })
    return () => {
      cancelled = true
    }
  }, [loading, userKey])

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

  if (loading || !hydrated || activeKey !== userKey) {
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

  // Empty store + user hasn't dismissed: offer to pull from cloud sync.
  const showRestore = restoreDismissedFor !== userKey && storeEmpty
  if (showRestore) {
    return (
      <View key={activeKey} style={{ flex: 1 }}>
        <RestoreBackupScreen onDismiss={() => setRestoreDismissedFor(userKey)} />
      </View>
    )
  }

  // Re-key children on user change so per-screen selectors re-evaluate against
  // the fresh snapshot, the same pattern as the web StoreProvider.
  return <View key={activeKey} style={{ flex: 1 }}>{children}</View>
}

function isStoreEmpty(snapshot: { workouts: unknown[]; exercises: { is_deleted?: boolean }[] }): boolean {
  if (snapshot.workouts.length > 0) return false
  return snapshot.exercises.every((e) => e.is_deleted)
}
