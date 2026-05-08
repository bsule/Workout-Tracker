import { useEffect, useState, type ReactNode } from "react"
import { ActivityIndicator, View } from "react-native"
import { useHydrated } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { theme } from "../theme/theme"
import { bootstrapForUser } from "./bootstrap"

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const userKey = user?.username ?? "anon"
  const hydrated = useHydrated()
  const [activeKey, setActiveKey] = useState<string | null>(null)

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

  // Re-key children on user change so per-screen selectors re-evaluate against
  // the fresh snapshot — same pattern as the web StoreProvider.
  return <View key={activeKey} style={{ flex: 1 }}>{children}</View>
}
