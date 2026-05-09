import { useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import {
  getWorkoutByDateQ,
  startPlannedWorkout,
  useStore,
} from "@lift/core"
import type { WorkoutExercise } from "@lift/core"
import { Button } from "./Button"
import { SetList } from "./SetList"
import { pressedStyle } from "../theme/pressable"
import { useCategoryColor } from "../categories/CategoryStylesProvider"
import { theme } from "../theme/theme"

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

function tintedBg(hex: string, alpha = 0.16): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(255,255,255,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

interface Props {
  date: string
  onPressExercise: (workoutId: number, weId: number) => void
}

export function DayWorkoutContent({ date, onPressExercise }: Props) {
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
}: {
  we: WorkoutExercise
  onPress: () => void
}) {
  const catColor = useCategoryColor(we.exercise.category)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.exerciseCard, pressedStyle(pressed)]}>
      <View style={styles.exerciseHeader}>
        <Text style={styles.exerciseName} numberOfLines={1}>
          {we.exercise.name}
        </Text>
        <View
          style={[
            styles.exerciseCatPill,
            { backgroundColor: tintedBg(catColor) },
          ]}
        >
          <Text style={[styles.exerciseCategory, { color: catColor }]}>
            {we.exercise.category}
          </Text>
        </View>
      </View>
      {we.sets.length === 0 ? (
        <Text style={styles.addFirst}>+ Add first set</Text>
      ) : (
        <SetList sets={we.sets} />
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
    backgroundColor: theme.colors.background,
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    backgroundColor: "transparent",
    borderBottomColor: "rgba(255,255,255,0.18)",
    borderBottomWidth: 1,
  },
  exerciseName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  exerciseCatPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  exerciseCategory: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  addFirst: { color: theme.colors.primary, padding: theme.spacing[4], fontSize: theme.fontSize.sm },
})
