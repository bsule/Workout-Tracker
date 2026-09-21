import { useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import {
  AuthInput,
  AuthScreenShell,
  FieldGroup,
  PasswordInput,
  ServerError,
} from "../components/auth/AuthForm"

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
    <AuthScreenShell
      title="Create your account"
      subtitle="Start tracking your workouts today"
      switchText="Already have an account? "
      switchLink="Sign in"
      onSwitch={() => navigation.goBack()}
    >
      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, value } }) => (
          <FieldGroup label="Username" error={errors.username?.message}>
            <AuthInput
              value={value}
              onChangeText={onChange}
              placeholder="your_username"
              hasError={!!errors.username}
            />
          </FieldGroup>
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <FieldGroup label="Email" error={errors.email?.message}>
            <AuthInput
              value={value}
              onChangeText={onChange}
              placeholder="you@example.com"
              keyboardType="email-address"
              hasError={!!errors.email}
            />
          </FieldGroup>
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <FieldGroup label="Password" error={errors.password?.message}>
            <PasswordInput
              value={value}
              onChangeText={onChange}
              hasError={!!errors.password}
            />
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
            <AuthInput
              value={value}
              onChangeText={onChange}
              placeholder="••••••••"
              secureTextEntry
              hasError={!!errors.confirmPassword}
            />
          </FieldGroup>
        )}
      />

      <ServerError message={serverError} />

      <Button
        label={isSubmitting ? "Creating account…" : "Create account"}
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
      />
    </AuthScreenShell>
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
