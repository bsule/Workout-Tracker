"use client"

import { useMemo } from "react"
import {
  getWorkoutByDateQ,
  startPlannedWorkout,
  useHydrated,
  useStore,
} from "@/lib/store"
import { ExerciseCard } from "@/components/day/ExerciseCard"
import { PlannedBanner } from "@/components/day/PlannedBanner"

/**
 * A read-mostly view of one day's workout, for the calendar's detail panel.
 * The web copy of mobile's DayWorkoutContent: no selection, and a card opens
 * the set logger.
 */
export function DayWorkoutContent({ date }: { date: string }) {
  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)
  const workout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, snapshot, date]
  )

  if (workout === undefined) return null
  if (!workout) return <Empty text="No workout on this day." />

  return (
    <div className="flex flex-col gap-3">
      {workout.status === "planned" && (
        <PlannedBanner
          date={date}
          title="Planned workout"
          onStart={() => startPlannedWorkout(workout.id)}
        />
      )}
      {workout.exercises.length === 0 ? (
        <Empty text="No exercises logged." />
      ) : (
        workout.exercises.map((we) => (
          <ExerciseCard
            key={we.id}
            workoutId={workout.id}
            we={we}
            showPlannedChip={false}
          />
        ))
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
