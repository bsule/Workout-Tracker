import { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import {
  formatWeight,
  getWorkoutByDateQ,
  startPlannedWorkout,
  useStore,
} from "@lift/core"
import type { WorkoutExercise } from "@lift/core"
import { Button } from "./Button"
import { CategoryBadge } from "./CategoryBadge"
import { PrIcon } from "./PrIcon"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useWeightUnit } from "../settings/SettingsProvider"

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

interface Props {
  date: string
  onPressExercise: (workoutId: number, weId: number) => void
  /** When true, render a more compact layout (used inside the Calendar tab). */
  compact?: boolean
}

export function DayWorkoutContent({ date, onPressExercise, compact }: Props) {
  const snapshot = useStore((s) => s.snapshot)
  const workout = useMemo(() => getWorkoutByDateQ(date), [snapshot, date])

  if (!workout) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No workout on this day.</Text>
      </View>
    )
  }

  const isFuture = date > todayString()

  return (
    <View style={{ gap: theme.spacing[3] }}>
      {workout.status === "planned" && (
        <View style={[styles.banner, isFuture ? styles.bannerFuture : styles.bannerToday]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.bannerTitle}>
              {isFuture ? "Planned workout" : "Planned workout"}
            </Text>
            <Text style={styles.bannerSub}>
              {isFuture
                ? "Edit targets now; start when the day arrives."
                : "Sets shown are targets, not logged yet."}
            </Text>
          </View>
          {!isFuture && (
            <Button label="Start" onPress={() => startPlannedWorkout(workout.id)} />
          )}
        </View>
      )}

      {workout.exercises.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No exercises logged.</Text>
        </View>
      ) : (
        <View style={{ gap: theme.spacing[3] }}>
          {workout.exercises.map((we) => (
            <ExerciseRow
              key={we.id}
              we={we}
              compact={compact}
              onPress={() => onPressExercise(workout.id, we.id)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

function ExerciseRow({
  we,
  onPress,
  compact,
}: {
  we: WorkoutExercise
  onPress: () => void
  compact?: boolean
}) {
  const unit = useWeightUnit()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.exerciseCard, pressedStyle(pressed)]}>
      <View style={styles.exerciseHeader}>
        <CategoryBadge slug={we.exercise.category} />
        <Text style={styles.exerciseName}>{we.exercise.name}</Text>
      </View>
      {we.sets.length === 0 ? (
        <Text style={styles.addFirst}>+ Add first set</Text>
      ) : (
        <View style={{ gap: 4, paddingVertical: compact ? 4 : 8 }}>
          {we.sets.map((s, i) => (
            <View key={s.id} style={[styles.setRow, s.is_planned && { opacity: 0.6 }]}>
              <View style={styles.setIcon}>
                {s.is_planned ? (
                  <View style={styles.plannedDot} />
                ) : s.is_pr || s.was_pr ? (
                  <PrIcon historical={!s.is_pr && s.was_pr} />
                ) : null}
              </View>
              <Text style={styles.setIndex}>{i + 1}</Text>
              <Text
                style={[
                  styles.setWeight,
                  s.is_planned && { fontStyle: "italic", color: theme.colors.muted },
                ]}
              >
                {formatWeight(s.weight, unit)} <Text style={styles.setUnit}>{unit}</Text>
              </Text>
              <Text
                style={[
                  styles.setReps,
                  s.is_planned && { fontStyle: "italic", color: theme.colors.muted },
                ]}
              >
                {s.reps ?? "—"}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    padding: theme.spacing[5],
    alignItems: "center",
  },
  emptyText: { color: theme.colors.muted, fontSize: theme.fontSize.sm },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    padding: theme.spacing[4],
  },
  bannerToday: {
    borderColor: theme.colors.primary,
    backgroundColor: "rgba(0,119,188,0.10)",
  },
  bannerFuture: {
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  bannerTitle: { color: theme.colors.foreground, fontWeight: "700", fontSize: theme.fontSize.sm },
  bannerSub: { color: theme.colors.muted, fontSize: theme.fontSize.xs },
  exerciseCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: "rgba(255,255,255,0.02)",
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
  },
  exerciseName: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "700" },
  addFirst: { color: theme.colors.primary, padding: theme.spacing[4], fontSize: theme.fontSize.sm },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 8,
    gap: theme.spacing[3],
    borderBottomColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setIcon: { width: 28, alignItems: "flex-start" },
  plannedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    borderWidth: 1.5,
  },
  setIndex: {
    width: 24,
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  setWeight: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    textAlign: "center",
  },
  setUnit: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
  setReps: {
    width: 50,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    textAlign: "right",
  },
})
