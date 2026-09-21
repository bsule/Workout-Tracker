import { useState, type ReactNode } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { theme } from "../../theme/theme"

/**
 * The frame shared by the Login and Signup screens: brand header, the card
 * with its gradient accent line, and the "switch to the other screen" row.
 * The screen supplies the form fields as children.
 */
export function AuthScreenShell({
  title,
  subtitle,
  switchText,
  switchLink,
  onSwitch,
  children,
}: {
  title: string
  subtitle: string
  switchText: string
  switchLink: string
  onSwitch: () => void
  children: ReactNode
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
      >
        <BrandHeader title={title} subtitle={subtitle} />

        <View style={styles.card}>
          <LinearGradient
            colors={[
              "rgba(0,119,188,0.6)",
              theme.colors.primary,
              "rgba(0,119,188,0.6)",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.accentLine}
          />

          <View style={{ gap: 16 }}>{children}</View>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{switchText}</Text>
          <Pressable onPress={onSwitch} hitSlop={8}>
            <Text style={styles.switchLink}>{switchLink}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export function BrandHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <View style={styles.brandWrap}>
      <View style={styles.brandIconWrap}>
        <Ionicons name="barbell" size={26} color={theme.colors.primary} />
      </View>
      <Text style={styles.brandTitle}>{title}</Text>
      <Text style={styles.brandSubtitle}>{subtitle}</Text>
    </View>
  )
}

export function FieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  )
}

interface AuthInputProps extends Omit<TextInputProps, "style"> {
  hasError?: boolean
}

export function AuthInput({ hasError, ...rest }: AuthInputProps) {
  return (
    <TextInput
      placeholderTextColor={theme.colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      style={[styles.input, hasError && styles.inputError]}
    />
  )
}

/** Password input with the show/hide eye button. */
export function PasswordInput({
  hasError,
  ...rest
}: Omit<AuthInputProps, "secureTextEntry">) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <View style={styles.passwordWrap}>
      <TextInput
        placeholder="••••••••"
        placeholderTextColor={theme.colors.muted}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[
          styles.input,
          styles.inputWithIcon,
          hasError && styles.inputError,
        ]}
      />
      <Pressable
        onPress={() => setShowPassword((v) => !v)}
        hitSlop={8}
        style={styles.eyeBtn}
        accessibilityLabel={showPassword ? "Hide password" : "Show password"}
      >
        <Ionicons
          name={showPassword ? "eye-off-outline" : "eye-outline"}
          size={18}
          color={theme.colors.muted}
        />
      </Pressable>
    </View>
  )
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null
  return <Text style={styles.serverError}>{message}</Text>
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    justifyContent: "center",
    padding: theme.spacing[5],
    gap: theme.spacing[5],
  },
  brandWrap: {
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  brandIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(0,119,188,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  brandTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
  },
  brandSubtitle: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[5],
    overflow: "hidden",
  },
  accentLine: {
    height: 2,
    width: "100%",
    borderRadius: 1,
    marginBottom: theme.spacing[4],
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
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
  inputWithIcon: {
    paddingRight: 38,
  },
  inputError: {
    borderColor: theme.colors.destructive,
  },
  passwordWrap: {
    position: "relative",
  },
  eyeBtn: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    width: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  serverError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  switchText: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
  },
  switchLink: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
})
