"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion, AnimatePresence } from "framer-motion"
import { Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { useWeightUnit } from "@/components/settings/SettingsProvider"

function calculateOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight
  return weight / (1.0278 - 0.0278 * reps)
}

const schema = z.object({
  weight: z
    .string()
    .min(1, "Enter a weight")
    .transform(Number)
    .pipe(z.number().positive("Weight must be positive")),
  reps: z
    .string()
    .min(1, "Enter reps")
    .transform(Number)
    .pipe(
      z
        .number()
        .int("Must be a whole number")
        .min(1, "Minimum 1 rep")
        .max(30, "Maximum 30 reps")
    ),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

const percentages = [
  { label: "100% — 1RM", pct: 1.0, description: "True max single" },
  { label: "90% — Heavy single", pct: 0.9, description: "Competition warmup" },
  { label: "80% — Working weight", pct: 0.8, description: "Strength building" },
  { label: "70% — Warm-up", pct: 0.7, description: "Technique work" },
]

export default function CalculatorPage() {
  const unit = useWeightUnit()
  const [result, setResult] = useState<number | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
  })

  function onSubmit({ weight, reps }: FormOutput) {
    setResult(calculateOneRepMax(weight, reps))
  }

  return (
    <PageWrapper>
      <div className="mx-auto max-w-lg px-4 py-16">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-primary/10">
            <Calculator className="size-6 text-primary" />
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
            1RM Calculator
          </h1>
          <p className="text-muted-foreground">
            Estimate your one-rep max using the Brzycki formula
          </p>
          <code className="mt-2 inline-block rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">
            w / (1.0278 - 0.0278 × r)
          </code>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-white/8 bg-card p-6 shadow-2xl">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="weight" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight ({unit})
                </Label>
                <Input
                  id="weight"
                  type="number"
                  placeholder="225"
                  className="h-12 text-base"
                  {...register("weight", {})}
                  aria-invalid={!!errors.weight}
                />
                {errors.weight && (
                  <p className="text-xs text-destructive">{errors.weight.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reps" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reps
                </Label>
                <Input
                  id="reps"
                  type="number"
                  placeholder="5"
                  className="h-12 text-base"
                  {...register("reps", {})}
                  aria-invalid={!!errors.reps}
                />
                {errors.reps && (
                  <p className="text-xs text-destructive">{errors.reps.message}</p>
                )}
              </div>
            </div>

            <Button type="submit" className="h-11 w-full text-sm font-semibold">
              Calculate
            </Button>
          </form>
        </div>

        {/* Result */}
        <AnimatePresence>
          {result !== null && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="mt-6"
            >
              {/* Main result */}
              <div className="rounded-2xl border border-primary/30 bg-primary/8 p-6 text-center shadow-lg shadow-primary/10">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                  Estimated 1RM
                </p>
                <p className="text-5xl font-extrabold tracking-tight text-foreground">
                  {Math.round(result)}{" "}
                  <span className="text-2xl font-medium text-muted-foreground">{unit}</span>
                </p>
              </div>

              {/* Percentage breakdown */}
              <div className="mt-4 rounded-2xl border border-white/8 bg-card overflow-hidden">
                <div className="border-b border-white/8 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Training Zones
                  </p>
                </div>
                {percentages.map(({ label, pct, description }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                    <p className="text-sm font-bold text-foreground tabular-nums">
                      {Math.round(result * pct)} {unit}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageWrapper>
  )
}
