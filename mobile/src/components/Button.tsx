import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native"
import { theme } from "../theme/theme"

type Variant = "primary" | "secondary" | "ghost" | "destructive"

interface Props {
  label: string
  onPress?: () => void
  onPressIn?: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
  /** Override the label/spinner color — use when overriding the background
   *  via `style` so the text stays readable. */
  labelColor?: string
}

export function Button({ label, onPress, onPressIn, variant = "primary", loading, disabled, style, labelColor }: Props) {
  const palette = paletteFor(variant)
  const fg = labelColor ?? palette.fg
  const isDisabled = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  )
}

// All variants are outline-style: transparent fill, colored border + text.
// Use `style` overrides on a per-call basis if a solid background is ever
// needed, but the default everywhere is the empty-middle look.
function paletteFor(v: Variant) {
  switch (v) {
    case "primary":
      return {
        bg: "transparent",
        fg: theme.colors.foreground,
        border: theme.colors.foreground,
      }
    case "secondary":
      return {
        bg: "transparent",
        fg: theme.colors.muted,
        border: theme.colors.border,
      }
    case "ghost":
      return { bg: "transparent", fg: theme.colors.foreground, border: "transparent" }
    case "destructive":
      return {
        bg: "transparent",
        fg: theme.colors.destructive,
        border: theme.colors.destructive,
      }
  }
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
})
