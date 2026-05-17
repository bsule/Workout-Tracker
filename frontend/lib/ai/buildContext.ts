import { listWorkoutsQ } from "@/lib/store"
import { fromKg, roundForDisplay, type WeightUnit } from "@lift/core"
import type { HistoryDay, HistoryExercise } from "./types"

interface ContextOpts {
  from: string
  to: string
  weightUnit: WeightUnit
  exerciseIds?: number[]
}

export function buildHistoryContext({ from, to, weightUnit, exerciseIds }: ContextOpts): HistoryDay[] {
  const filterIds = exerciseIds && exerciseIds.length > 0 ? new Set(exerciseIds) : null

  const all = listWorkoutsQ()
  const days: HistoryDay[] = []

  for (const w of all) {
    if (w.date < from || w.date > to) continue
    if (w.status === "planned") continue

    const exs: HistoryExercise[] = []
    for (const we of w.exercises) {
      if (filterIds && !filterIds.has(we.exercise.id)) continue

      const sets = we.sets
        .filter((s) => !s.is_planned)
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          weight: s.weight == null ? s.weight : roundForDisplay(fromKg(s.weight, weightUnit), weightUnit),
          reps: s.reps,
          distance_m: s.distance_m,
          time_seconds: s.time_seconds,
        }))

      if (sets.length === 0) continue
      exs.push({
        name: we.exercise.name,
        category: we.exercise.category,
        kind: we.exercise.kind,
        sets,
      })
    }

    if (exs.length === 0) continue
    days.push({ date: w.date, exercises: exs })
  }

  days.sort((a, b) => (a.date < b.date ? 1 : -1))
  return days.slice(0, 40)
}
