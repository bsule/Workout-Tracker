import { lazy, Suspense, useEffect, useState } from "react"
import { View } from "react-native"
import { StatusBar } from "expo-status-bar"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context"
import { AuthProvider } from "./src/auth/AuthProvider"
import { StoreProvider } from "./src/store/StoreProvider"
import { SettingsProvider } from "./src/settings/SettingsProvider"
import { ActiveDateProvider } from "./src/state/activeDate"
import { ThemeProvider } from "./src/theme/ThemeProvider"
import { getStoredMode, init as initTheme, currentMode } from "./src/theme/themeMode"
import { CategoryStylesProvider } from "./src/categories/CategoryStylesProvider"

// Lazy-import the navigator so its tree of screens (each calling
// `StyleSheet.create({ ... theme.colors.x })` at module load) doesn't
// evaluate until AFTER `initTheme()` has applied the stored mode.
// Without the lazy gate, every screen would cache dark colors at
// module-load time regardless of the user's preference.
const RootNavigator = lazy(() =>
  import("./src/navigation/RootNavigator").then((m) => ({
    default: m.RootNavigator,
  }))
)

export default function App() {
  const [themeReady, setThemeReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mode = await getStoredMode()
      initTheme(mode)
      if (!cancelled) setThemeReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!themeReady) {
    // Neutral loading frame; no theme dependence so we don't bake in
    // either palette before the stored mode is known.
    return <View style={{ flex: 1, backgroundColor: "#0a0a0a" }} />
  }

  const mode = currentMode()
  return (
    <GestureHandlerRootView
      style={{
        flex: 1,
        backgroundColor: mode === "dark" ? "#0a0a0a" : "#fafafa",
      }}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <AuthProvider>
            <StoreProvider>
              <SettingsProvider>
                <CategoryStylesProvider>
                <ActiveDateProvider>
                  <StatusBar style={mode === "dark" ? "light" : "dark"} />
                  <Suspense
                    fallback={
                      <View
                        style={{
                          flex: 1,
                          backgroundColor:
                            mode === "dark" ? "#0a0a0a" : "#fafafa",
                        }}
                      />
                    }
                  >
                    <RootNavigator />
                  </Suspense>
                </ActiveDateProvider>
                </CategoryStylesProvider>
              </SettingsProvider>
            </StoreProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
