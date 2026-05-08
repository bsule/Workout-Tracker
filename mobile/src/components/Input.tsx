import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native"
import { theme } from "../theme/theme"

interface Props extends TextInputProps {
  label?: string
  error?: string
}

export function Input({ label, error, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={theme.colors.muted}
        {...rest}
        style={[styles.input, error && { borderColor: theme.colors.destructive }, style]}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  input: {
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
})
