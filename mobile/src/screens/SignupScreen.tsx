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
import { BrandHeader, FieldGroup } from "./LoginScreen"

const schema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
type FormValues = z.infer<typeof schema>

export function SignupScreen({ navigation }: any) {
  const { signup } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  const password = watch("password", "")

  async function onSubmit(data: FormValues) {
    setServerError(null)
    try {
      await signup({
        username: data.username.trim(),
        email: data.email.trim(),
        password: data.password,
      })
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Sign up failed. Try again."
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
        <BrandHeader
          title="Create your account"
          subtitle="Start tracking your workouts today"
        />

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
                    style={[styles.input, errors.username && styles.inputError]}
                  />
                </FieldGroup>
              )}
            />

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, value } }) => (
                <FieldGroup label="Email" error={errors.email?.message}>
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="you@example.com"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, errors.email && styles.inputError]}
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
                  <PasswordStrength password={password} />
                </FieldGroup>
              )}
            />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, value } }) => (
                <FieldGroup
                  label="Confirm password"
                  error={errors.confirmPassword?.message}
                >
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="••••••••"
                    placeholderTextColor={theme.colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      errors.confirmPassword && styles.inputError,
                    ]}
                  />
                </FieldGroup>
              )}
            />

            {serverError && (
              <Text style={styles.serverError}>{serverError}</Text>
            )}

            <Button
              label={isSubmitting ? "Creating account…" : "Create account"}
              onPress={handleSubmit(onSubmit)}
              loading={isSubmitting}
            />
          </View>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Already have an account? </Text>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={styles.switchLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// Mirror of the web's PasswordStrength component: 4 segments + label,
// scored on length / case / digit / symbol classes.
function PasswordStrength({ password }: { password: string }) {
  const score = Math.min(
    4,
    [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password))
      .length
  )
  const labels = ["", "Weak", "Fair", "Good", "Strong"]
  const colors = [
    theme.colors.muted,
    theme.colors.destructive,
    "#f59e0b",
    "#facc15",
    "#10b981",
  ]
  return (
    <View style={styles.strengthRow}>
      <View style={styles.strengthBars}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.strengthBar,
              {
                backgroundColor:
                  i <= score ? colors[score] : "rgba(255,255,255,0.08)",
              },
            ]}
          />
        ))}
      </View>
      {!!password && (
        <Text style={styles.strengthLabel}>{labels[score]}</Text>
      )}
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
  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  strengthBars: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    width: 50,
    textAlign: "right",
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
  },
})
