import { useScreenSnapshot } from "../store/useScreenSnapshot"
import { useCallback, useMemo, useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  getExerciseHistoryQ,
  listExercisesQ,
  localApi as api,
} from "@lift/core"
import type { Exercise, ExerciseHistoryDay } from "@lift/core"
import { CategoryBadge } from "../components/CategoryBadge"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { useSettings } from "../settings/SettingsProvider"
import {
  GraphPanel,
  PastHistory,
  SettingsPanel,
  SummaryPanel,
} from "./SetLoggerScreen"
import { todayString } from "../dates"
import { formatRelative } from "@lift/core/format"
import { SubTabBar, type SubTab as LoggerSubTab } from "../components/SubTabBar"

type SubTab = Exclude<LoggerSubTab, "workout">

export function ExerciseDetailScreen({ navigation, route }: any) {
  const { exerciseId } = route.params
  const snapshot = useScreenSnapshot()
  const { weightUnit: unit, showOneRm } = useSettings()
  const [tab, setTab] = useState<SubTab>("history")

  const exercise: Exercise | null = useMemo(() => {
    return listExercisesQ({ sort: "name" }).find((e) => e.id === exerciseId) ?? null
  }, [snapshot, exerciseId])

  const history: ExerciseHistoryDay[] = useMemo(
    () => getExerciseHistoryQ(exerciseId),
    [snapshot, exerciseId]
  )

  // Every hook sits above the early return below, so a render where the
  // exercise is gone calls the same hooks as one where it exists.
  const openCalendarAtDate = useCallback(
    (date: string) => {
      // Push the calendar onto the stack instead of jumping to the Calendar
      // tab. Stack push leaves MainTabs frozen, so the destination paints
      // without the unfreeze fan-out (DayScreen + ExercisesScreen all
      // re-running queries on the same frame as the pop animation).
      navigation.navigate("CalendarDate", { date })
    },
    [navigation]
  )

  if (!exercise) {
    return (
      <View style={[styles.flex, { padding: theme.spacing[4] }]}>
        <Text style={{ color: theme.colors.muted }}>Exercise not found.</Text>
      </View>
    )
  }

  async function logToday() {
    const today = todayString()
    const workout = await api.createWorkout(today)
    const we = await api.addExerciseToWorkout(workout.id, exercise!.id)
    navigation.replace("SetLogger", { workoutId: workout.id, weId: we.id })
  }

  const totalWorkouts = history.length
  const lastDate = history[0]?.date ?? null

  return (
    <View style={styles.flex}>
      <View style={styles.fixedTop}>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{exercise.name}</Text>
          <CategoryBadge slug={exercise.category} />
        </View>

        {tab === "history" && (
          <>
            <View style={styles.statsRow}>
              <Stat label="Workouts" value={String(totalWorkouts)} />
              <Stat label="Last" value={lastDate ? formatRelative(lastDate) : "-"} />
            </View>

            <Button label="Log a set" onPress={logToday} />
          </>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        // No top inset: the fixed header above already ends in its own
        // padding, which is the line every tab's first card starts on. Same
        // as the set logger's scroll container.
        contentContainerStyle={{
          paddingHorizontal: theme.spacing[4],
          paddingBottom: theme.spacing[6],
        }}
      >
        {tab === "history" && (
          <PastHistory
            days={history}
            currentDate={todayString()}
            onPressDate={openCalendarAtDate}
          />
        )}
        {tab === "graph" && <GraphPanel days={history} unit={unit} />}
        {tab === "summary" && (
          <SummaryPanel
            days={history}
            unit={unit}
            onPressDate={openCalendarAtDate}
          />
        )}
        {tab === "settings" && <SettingsPanel navigation={navigation} />}
      </ScrollView>

      <SubTabBar tab={tab} onChange={setTab} withWorkout={false} />
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  fixedTop: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
  },
  headerInfo: { gap: 6 },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.xl, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: theme.spacing[3] },
  stat: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
    gap: 4,
  },
  statLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  statValue: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700" },
})
