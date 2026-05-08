import { useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"

const schema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})
type FormValues = z.infer<typeof schema>

export function LoginScreen({ navigation }: any) {
  const { login } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  })

  async function onSubmit(data: FormValues) {
    setServerError(null)
    try {
      await login(data.username.trim(), data.password)
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Sign in failed. Try again."
      )
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
      >
        <BrandHeader title="Welcome back" subtitle="Sign in to your LIFT account" />

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

          <View style={{ gap: 16 }}>
            <Controller
              control={control}
              name="username"
              render={({ field: { onChange, value } }) => (
                <FieldGroup label="Username" error={errors.username?.message}>
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="your_username"
                    placeholderTextColor={theme.colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      errors.username && styles.inputError,
                    ]}
                  />
                </FieldGroup>
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, value } }) => (
                <FieldGroup label="Password" error={errors.password?.message}>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      value={value}
                      onChangeText={onChange}
                      placeholder="••••••••"
                      placeholderTextColor={theme.colors.muted}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[
                        styles.input,
                        styles.inputWithIcon,
                        errors.password && styles.inputError,
                      ]}
                    />
                    <Pressable
                      onPress={() => setShowPassword((v) => !v)}
                      hitSlop={8}
                      style={styles.eyeBtn}
                      accessibilityLabel={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color={theme.colors.muted}
                      />
                    </Pressable>
                  </View>
                </FieldGroup>
              )}
            />

            {serverError && (
              <Text style={styles.serverError}>{serverError}</Text>
            )}

            <Button
              label={isSubmitting ? "Signing in…" : "Sign in"}
              onPress={handleSubmit(onSubmit)}
              loading={isSubmitting}
            />
          </View>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Don't have an account? </Text>
          <Pressable onPress={() => navigation.navigate("Signup")} hitSlop={8}>
            <Text style={styles.switchLink}>Sign up</Text>
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
  children: React.ReactNode
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  )
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
