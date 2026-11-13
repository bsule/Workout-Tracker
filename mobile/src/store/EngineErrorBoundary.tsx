import { Component, type ReactNode } from "react"
import { Pressable, Text, View } from "react-native"
import { theme } from "../theme/theme"

/**
 * Catches a failed engine read (queryValue throws it) so the screen shows
 * what happened instead of rendering the failure as an empty day or list.
 *
 * Styles are inline, read at render: StoreProvider loads before App.tsx
 * applies the stored theme, so a module-level StyleSheet here would keep the
 * dark palette in light mode.
 */
export class EngineErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown) {
    console.error("Engine read failed:", error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: theme.spacing[6],
          gap: theme.spacing[4],
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
          Your data could not be read. Try again, or close and reopen the app.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            this.setState({ error: null })
            this.props.onRetry()
          }}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing[5],
            paddingVertical: theme.spacing[3],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.primary,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: theme.colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </View>
    )
  }
}
