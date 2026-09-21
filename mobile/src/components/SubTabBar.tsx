import { memo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { theme } from "../theme/theme"

export type SubTab = "workout" | "history" | "graph" | "summary" | "settings"

const ITEMS: { key: SubTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "workout", label: "Workout", icon: "barbell-outline" },
  { key: "history", label: "History", icon: "list-outline" },
  { key: "graph", label: "Graph", icon: "stats-chart-outline" },
  { key: "summary", label: "Summary", icon: "reader-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
]
const ITEMS_WITHOUT_WORKOUT = ITEMS.filter((it) => it.key !== "workout")

/**
 * The per-exercise tab bar at the bottom of SetLogger and ExerciseDetail.
 * ExerciseDetail has no "Workout" tab, so it passes `withWorkout={false}`.
 * Memoized: its only inputs are the active tab and the (stable) setter.
 */
function SubTabBarImpl<T extends SubTab>({
  tab,
  onChange,
  withWorkout = true,
}: {
  tab: T
  onChange: (t: T) => void
  withWorkout?: boolean
}) {
  const items = withWorkout ? ITEMS : ITEMS_WITHOUT_WORKOUT
  return (
    <View style={styles.subTabBar}>
      {items.map((it) => {
        const active = tab === it.key
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key as T)}
            // Catches the few points above the bar's top border as well; the
            // only thing up there is the scroll view's bottom padding.
            hitSlop={{ top: 6 }}
            style={styles.subTabBtn}
          >
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

export const SubTabBar = memo(SubTabBarImpl) as typeof SubTabBarImpl

const styles = StyleSheet.create({
  // The bottom inset belongs to the buttons, not to the bar. As bar padding
  // it was 24pt of dead space directly under the labels — exactly where a
  // thumb lands reaching down — and it left each button at 42pt, under the
  // 44pt minimum and 10pt shorter than the main tab bar.
  subTabBar: {
    flexDirection: "row",
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  // Same total height as before — the 24pt moved down here — so nothing on
  // screen shifts, but the strip below the label is now part of the target.
  subTabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: theme.radius.md,
    minHeight: 48,
    paddingTop: 4,
    paddingBottom: 28,
  },
  subTabLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
})
