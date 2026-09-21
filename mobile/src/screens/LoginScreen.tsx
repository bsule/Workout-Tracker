import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { Button } from "../components/Button"
import {
  AuthInput,
  AuthScreenShell,
  FieldGroup,
  PasswordInput,
  ServerError,
} from "../components/auth/AuthForm"

const schema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})
type FormValues = z.infer<typeof schema>

export function LoginScreen({ navigation }: any) {
  const { login } = useAuth()
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
    <AuthScreenShell
      title="Welcome back"
      subtitle="Sign in to your LIFT account"
      switchText="Don't have an account? "
      switchLink="Sign up"
      onSwitch={() => navigation.navigate("Signup")}
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
        name="password"
        render={({ field: { onChange, value } }) => (
          <FieldGroup label="Password" error={errors.password?.message}>
            <PasswordInput
              value={value}
              onChangeText={onChange}
              hasError={!!errors.password}
            />
          </FieldGroup>
        )}
      />

      <ServerError message={serverError} />

      <Button
        label={isSubmitting ? "Signing in…" : "Sign in"}
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
      />
    </AuthScreenShell>
  )
}
