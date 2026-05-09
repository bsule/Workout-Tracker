import { useCallback, useMemo, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import {
  getExerciseHistoryQ,
  listExercisesQ,
  localApi as api,
  useStore,
} from "@lift/core"
import type { Exercise, ExerciseHistoryDay } from "@lift/core"
import { CategoryBadge } from "../components/CategoryBadge"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { useSettings } from "../settings/SettingsProvider"
import {
  GraphPanel,
  PastHistory,
  RecordsPanel,
  SettingsPanel,
} from "./SetLoggerScreen"

type SubTab = "history" | "graph" | "records" | "settings"

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

export function ExerciseDetailScreen({ navigation, route }: any) {
  const { exerciseId } = route.params
  const snapshot = useStore((s) => s.snapshot)
  const { weightUnit: unit, showOneRm } = useSettings()
  const [tab, setTab] = useState<SubTab>("history")

  const exercise: Exercise | null = useMemo(() => {
    return listExercisesQ({ sort: "name" }).find((e) => e.id === exerciseId) ?? null
  }, [snapshot, exerciseId])

  const history: ExerciseHistoryDay[] = useMemo(
    () => getExerciseHistoryQ(exerciseId),
    [snapshot, exerciseId]
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

  const openCalendarAtDate = useCallback(
    (date: string) => {
      navigation.setOptions({ animation: "none" })
      navigation.navigate("Main", { screen: "Calendar", params: { date } })
    },
    [navigation]
  )

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
              <Stat label="Last" value={lastDate ? formatRelative(lastDate) : "—"} />
            </View>

            <Button label="Log a set" onPress={logToday} />
          </>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[6] }}
      >
        {tab === "history" && (
          <PastHistory
            days={history}
            currentDate={todayString()}
            onPressDate={openCalendarAtDate}
          />
        )}
        {tab === "graph" && <GraphPanel days={history} unit={unit} />}
        {tab === "records" && <RecordsPanel days={history} unit={unit} />}
        {tab === "settings" && <SettingsPanel navigation={navigation} />}
      </ScrollView>

      <SubTabBar tab={tab} onChange={setTab} />
    </View>
  )
}

function SubTabBar({ tab, onChange }: { tab: SubTab; onChange: (t: SubTab) => void }) {
  const items: { key: SubTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "history", label: "History", icon: "list-outline" },
    { key: "graph", label: "Graph", icon: "stats-chart-outline" },
    { key: "records", label: "Records", icon: "trophy-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
  ]
  return (
    <View style={styles.subTabBar}>
      {items.map((it) => {
        const active = tab === it.key
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} style={styles.subTabBtn}>
            <Ionicons
              name={it.icon}
              size={20}
              color={active ? theme.colors.foreground : theme.colors.muted}
            />
            <Text
              style={[
                styles.subTabLabel,
                active && { color: theme.colors.foreground },
              ]}
            >
              {it.label}
            </Text>
          </Pressable>
        )
      })}
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

function formatRelative(d: string): string {
  const today = new Date(todayString() + "T00:00:00")
  const target = new Date(d + "T00:00:00")
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`
  return `${Math.floor(diff / 30)}mo ago`
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
  subTabBar: {
    flexDirection: "row",
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 24,
  },
  subTabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  subTabLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
})
