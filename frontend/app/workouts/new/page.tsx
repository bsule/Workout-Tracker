"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Dumbbell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { ApiError, api } from "@/lib/api"

const schema = z.object({
  name: z
    .string()
    .min(1, "Workout name is required")
    .max(100, "Keep it under 100 characters"),
})

type FormValues = z.infer<typeof schema>

export default function NewWorkoutPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormValues) {
    setServerError(null)
    try {
      const workout = await api.createWorkout(data.name)
      router.push(`/workouts/${workout.id}`)
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create workout."
      )
    }
  }

  return (
    <PageWrapper>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <Dumbbell className="size-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              New Workout
            </h1>
            <p className="text-sm text-muted-foreground">
              Give your routine a name to get started
            </p>
          </div>

          <div className="rounded-2xl border border-white/8 bg-card p-6 shadow-2xl">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Workout Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="e.g., Bench Press"
                  className="h-11 text-base"
                  {...register("name")}
                  aria-invalid={!!errors.name}
                  autoFocus
                />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tip: name it after the main movement (Squat, Deadlift, OHP…)
                </p>
              </div>

              {serverError && (
                <p className="text-xs text-destructive">{serverError}</p>
              )}

              <Button
                type="submit"
                className="mt-1 h-10 w-full font-semibold"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating…" : "Create Workout"}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center">
            <Link
              href="/workouts"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to workouts
            </Link>
          </p>
        </div>
      </div>
    </PageWrapper>
  )
}
