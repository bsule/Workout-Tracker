"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const schema = z.object({
  weight: z
    .string()
    .min(1, "Enter a weight")
    .transform(Number)
    .pipe(z.number().positive("Must be positive")),
  reps: z
    .string()
    .min(1, "Enter reps")
    .transform(Number)
    .pipe(z.number().int().min(1, "Min 1 rep").max(100, "Max 100 reps")),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

export function WorkoutLogForm({
  onSubmit,
}: {
  onSubmit: (weight: number, reps: number) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) })

  function handleFormSubmit(data: FormOutput) {
    onSubmit(data.weight, data.reps)
    reset()
  }

  return (
    <div className="rounded-xl border border-white/8 bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-foreground">Log a Set</h2>
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5 flex-1">
            <Label htmlFor="weight" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Weight (lbs)
            </Label>
            <Input
              id="weight"
              type="number"
              placeholder="225"
              className="h-10"
              {...register("weight")}
              aria-invalid={!!errors.weight}
            />
            {errors.weight && (
              <p className="text-xs text-destructive">{errors.weight.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            <Label htmlFor="reps" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reps
            </Label>
            <Input
              id="reps"
              type="number"
              placeholder="5"
              className="h-10"
              {...register("reps")}
              aria-invalid={!!errors.reps}
            />
            {errors.reps && (
              <p className="text-xs text-destructive">{errors.reps.message}</p>
            )}
          </div>

          <Button type="submit" className="h-10 gap-1.5 sm:w-auto w-full">
            <Plus className="size-4" />
            Add Set
          </Button>
        </div>
      </form>
    </div>
  )
}
