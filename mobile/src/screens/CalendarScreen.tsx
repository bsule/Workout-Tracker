import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import {
  getCalendarQ,
  getPlannedDatesQ,
  getWorkoutByDateQ,
  useStore,
} from "@lift/core"
import type { Category } from "@lift/core"
import { DayWorkoutContent } from "../components/DayWorkoutContent"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { useActiveDateAndSetter } from "../state/activeDate"
import { pressedStyle } from "../theme/pressable"
import { useSettings } from "../settings/SettingsProvider"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"

const WEEKDAY_LABELS_SUNDAY = ["S", "M", "T", "W", "T", "F", "S"]
const WEEKDAY_LABELS_MONDAY = ["M", "T", "W", "T", "F", "S", "S"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function CalendarScreen({ navigation, route }: any) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1) // 1-indexed
  const [selectedDate, setSelectedDate] = useState<string>(todayString())
  const { setDate: setActiveDate } = useActiveDateAndSetter()

  // When another screen navigates here with `{ date }`, jump to that month +
  // select that day. This consumes the param via the "derived state" pattern
  // (setState during render): the very first commit after the navigation
  // already shows the correct month/date, so the user doesn't see the old
  // month flash for a frame underneath the back-slide animation.
  const incomingDate: string | undefined = route?.params?.date
  const [consumedDate, setConsumedDate] = useState<string | undefined>(undefined)
  if (incomingDate && incomingDate !== consumedDate) {
    const y = Number(incomingDate.slice(0, 4))
    const m = Number(incomingDate.slice(5, 7))
    if (y && m) {
      setYear(y)
      setMonth(m)
    }
    setSelectedDate(incomingDate)
    setConsumedDate(incomingDate)
  }
  useEffect(() => {
    if (!incomingDate || incomingDate !== consumedDate) return
    setActiveDate(incomingDate)
    navigation.setParams({ date: undefined })
  }, [incomingDate, consumedDate])

  const { firstDayOfWeek } = useSettings()
  const snapshot = useStore((s) => s.snapshot)
  const cells = useMemo(
    () => buildMonthGrid(year, month, firstDayOfWeek),
    [year, month, firstDayOfWeek]
  )
  const weekdayLabels =
    firstDayOfWeek === 1 ? WEEKDAY_LABELS_MONDAY : WEEKDAY_LABELS_SUNDAY
  const calendar = useMemo(
    () => getCalendarQ(year, month),
    [snapshot, year, month]
  )
  const plannedDates = useMemo(
    () => new Set(getPlannedDatesQ(year, month)),
    [snapshot, year, month]
  )
  const selectedGym = useMemo(
    () => getWorkoutByDateQ(selectedDate)?.gym?.trim() || null,
    [snapshot, selectedDate]
  )

  const todayKey = todayString()

  function shiftMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  function goToday() {
    const d = new Date()
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  function openDay(date: string) {
    setSelectedDate(date)
    // Make this date the "active" target for the global "+" tab too, so a
    // user who picks a calendar day then taps "+" adds to that day.
    setActiveDate(date)
  }

  function openSetLogger(workoutId: number, weId: number) {
    navigation.navigate("SetLogger", { workoutId, weId })
  }

  return (
    <StaticSafeAreaView>
      {/* Pinned calendar (header + weekdays + grid). */}
      <View style={styles.pinned}>
        <View style={styles.header}>
          <Pressable
            onPress={() => shiftMonth(-1)}
            hitSlop={12}
            style={({ pressed }) => [styles.navIconBtn, pressedStyle(pressed)]}
          >
            <Ionicons name="chevron-back" size={22} color={theme.colors.foreground} />
          </Pressable>
          <Pressable onPress={goToday} style={({ pressed }) => [styles.titleWrap, pressedStyle(pressed)]}>
            <Text style={styles.title}>
              {MONTH_NAMES[month - 1]} {year}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => shiftMonth(1)}
            hitSlop={12}
            style={({ pressed }) => [styles.navIconBtn, pressedStyle(pressed)]}
          >
            <Ionicons name="chevron-forward" size={22} color={theme.colors.foreground} />
          </Pressable>
        </View>

        <View style={styles.weekdayRow}>
          {weekdayLabels.map((d, i) => (
            <Text key={i} style={styles.weekday}>{d}</Text>
          ))}
        </View>

        <View style={[styles.grid, { padding: theme.spacing[2] }]}>
          {cells.map((cell, i) => (
            <DayCell
              key={i}
              cell={cell}
              cats={cell.date ? calendar[cell.date] : undefined}
              planned={cell.date ? plannedDates.has(cell.date) : false}
              isToday={cell.date === todayKey}
              isSelected={cell.date === selectedDate}
              onPress={cell.date ? () => openDay(cell.date!) : undefined}
            />
          ))}
        </View>
      </View>

      {/* Only the workout detail scrolls. */}
      <ScrollView
        style={styles.detailScroll}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.detail}>
          <View style={styles.detailHeader}>
            <View style={styles.detailTitleCol}>
              <Text style={styles.detailTitle}>{niceLongDate(selectedDate)}</Text>
              {selectedGym && (
                <Text style={styles.detailGym} numberOfLines={1}>
                  📍 {selectedGym}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => {
                setActiveDate(selectedDate)
                navigation.navigate("Today", { date: selectedDate })
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.goToDateBtn, pressedStyle(pressed)]}
            >
              <Text style={styles.goToDateText}>Go to date</Text>
              <Ionicons
                name="arrow-forward"
                size={14}
                color={theme.colors.foreground}
              />
            </Pressable>
          </View>
          <DayWorkoutContent
            date={selectedDate}
            onPressExercise={openSetLogger}
          />
        </View>
      </ScrollView>
    </StaticSafeAreaView>
  )
}

function niceLongDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

interface Cell {
  date: string | null
  day: number | null
}

function buildMonthGrid(
  year: number,
  month: number,
  firstDayOfWeek: 0 | 1
): Cell[] {
  // first weekday of the month (0=Sun .. 6=Sat)
  const first = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: Cell[] = []
  // Number of leading blanks: how many slots before the 1st when the row
  // starts on `firstDayOfWeek`. (first - firstDayOfWeek + 7) % 7 handles
  // both Sun-start (0) and Mon-start (1).
  const leading = (first - firstDayOfWeek + 7) % 7
  for (let i = 0; i < leading; i++) cells.push({ date: null, day: null })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: ymd(year, month, d), day: d })
  }
  // Pad to a 6×7 grid for stable layout.
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
  return cells
}

function DayCell({
  cell,
  cats,
  planned,
  isToday,
  isSelected,
  onPress,
}: {
  cell: Cell
  cats: Category[] | undefined
  planned: boolean
  isToday: boolean
  isSelected: boolean
  onPress?: () => void
}) {
  const hasWorkout = cats !== undefined
  const isPlannedOnly = planned && (!cats || cats.length === 0)
  const { colors: categoryColors } = useCategoryStyles()

  if (!cell.date) return <View style={styles.cell} />

  function colorFor(c: string): string {
    return categoryColors[c] ?? theme.colors.cat[c] ?? theme.colors.muted
  }

  return (
    <Pressable onPress={onPress} style={styles.cell}>
      <View
        style={[
          styles.cellInner,
          isToday && styles.cellToday,
          isSelected && styles.cellSelected,
        ]}
      >
        <Text
          style={[
            styles.dayNum,
            isToday && styles.dayNumToday,
            isSelected && styles.dayNumSelected,
          ]}
        >
          {cell.day}
        </Text>
        <View style={styles.dotsRow}>
          {hasWorkout && cats!.length > 0 ? (
            cats!.slice(0, 4).map((c, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: colorFor(c) }]} />
            ))
          ) : isPlannedOnly ? (
            <View style={styles.plannedRing} />
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pinned: {
    backgroundColor: theme.colors.background,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  navIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    borderRadius: theme.radius.md,
    paddingVertical: 6,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  weekdayRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    letterSpacing: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 3,
  },
  cellInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cellToday: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  cellSelected: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: theme.colors.navAccent,
  },
  dayNum: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  dayNumToday: {
    color: theme.colors.navAccent,
    fontWeight: "800",
  },
  dayNumSelected: {
    color: theme.colors.navAccent,
    fontWeight: "800",
  },
  detail: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailScroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  detailTitleCol: {
    flex: 1,
    gap: 2,
  },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  detailGym: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
  },
  goToDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  goToDateText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 3,
    marginTop: 4,
    minHeight: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  plannedRing: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.muted,
  },
})
