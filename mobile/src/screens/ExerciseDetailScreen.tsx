import { useCallback, useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import type { Exercise, ExerciseHistoryDay } from "@lift/core"
import { queryValue, useExerciseQuery, useFullExerciseHistory } from "@lift/engine-client/react"
import { useStableValue } from "../hooks/useStableValue"
import { sameHistory } from "../store/sameHistory"
import { useScreenQueryOptions } from "../engine/screenQuery"
import { CategoryBadge } from "../components/CategoryBadge"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { useSettings } from "../settings/SettingsProvider"
import {
  GraphPanel,
  PastHistoryList,
  SettingsPanel,
  SummaryPanel,
} from "./SetLoggerScreen"
import { todayString } from "../dates"
import { formatRelative } from "@lift/core/format"
import { SubTabBar, type SubTab as LoggerSubTab } from "../components/SubTabBar"

type SubTab = Exclude<LoggerSubTab, "workout">

const EMPTY_HISTORY: ExerciseHistoryDay[] = []

export function ExerciseDetailScreen({ navigation, route }: any) {
  const { exerciseId } = route.params
  const { weightUnit: unit } = useSettings()
  const [tab, setTab] = useState<SubTab>("history")

  const queryOptions = useScreenQueryOptions()
  const exerciseQuery = useExerciseQuery(exerciseId, queryOptions)
  const exercise: Exercise | null = queryValue(exerciseQuery, null)

  // The whole history: History, Graph and Records read every day.
  const historyQuery = useFullExerciseHistory(exerciseId, queryOptions)
  const history: ExerciseHistoryDay[] = useStableValue(
    queryValue(historyQuery, null)?.items ?? EMPTY_HISTORY,
    sameHistory
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
    // Still reading: the background alone, not a claim that it is gone.
    if (exerciseQuery.status === "loading") return <View style={styles.flex} />
    return (
      <View style={[styles.flex, { padding: theme.spacing[4] }]}>
        <Text style={{ color: theme.colors.muted }}>Exercise not found.</Text>
      </View>
    )
  }

  // Opens the logger at once, like the picker: the first saved set creates
  // the day's workout and this exercise's row (or reuses them) in one write,
  // and backing out without a set leaves nothing behind.
  function logToday() {
    const ex = exercise!
    navigation.replace("SetLogger", {
      pendingCreate: {
        date: todayString(),
        exerciseId: ex.id,
        exerciseName: ex.name,
        exerciseCategory: ex.category,
      },
    })
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

      {tab === "history" ? (
        <PastHistoryList
          days={history}
          currentDate={todayString()}
          onPressDate={openCalendarAtDate}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing[4],
            paddingBottom: theme.spacing[6],
          }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing[4],
            paddingBottom: theme.spacing[6],
          }}
        >
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
      )}

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
