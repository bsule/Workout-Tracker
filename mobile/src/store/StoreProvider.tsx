import { useEffect, useState, type ReactNode } from "react"
import { ActivityIndicator, View } from "react-native"
import { useHydrated, useStore } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { theme } from "../theme/theme"
import { RestoreBackupScreen } from "../screens/RestoreBackupScreen"
import { bootstrapForUser } from "./bootstrap"

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const userKey = user?.username ?? "anon"
  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [restoreDismissedFor, setRestoreDismissedFor] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    let cancelled = false
    bootstrapForUser(userKey)
      .then(() => {
        if (!cancelled) setActiveKey(userKey)
      })
      .catch((e) => {
        console.error("Local store bootstrap failed:", e)
      })
    return () => {
      cancelled = true
    }
  }, [loading, userKey])

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

  // Logged-in + empty store + user hasn't dismissed: offer to restore from a
  // Files / iCloud Drive backup. Skipped for "anon" so the unauthenticated
  // login screen never shows the restore prompt.
  const showRestore =
    user != null &&
    restoreDismissedFor !== userKey &&
    isStoreEmpty(snapshot)
  if (showRestore) {
    return (
      <View key={activeKey} style={{ flex: 1 }}>
        <RestoreBackupScreen onDismiss={() => setRestoreDismissedFor(userKey)} />
      </View>
    )
  }

  // Re-key children on user change so per-screen selectors re-evaluate against
  // the fresh snapshot — same pattern as the web StoreProvider.
  return <View key={activeKey} style={{ flex: 1 }}>{children}</View>
}

function isStoreEmpty(snapshot: { workouts: unknown[]; exercises: { is_deleted?: boolean }[] }): boolean {
  if (snapshot.workouts.length > 0) return false
  return snapshot.exercises.every((e) => e.is_deleted)
}
