import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AccessibilityInfo,
  Animated,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  VirtualizedList,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import {
  getCalendarQ,
  getDayNoteQ,
  getPlannedDatesQ,
  getWorkoutByDateQ,
  setDayNote,
  useStore,
} from "@lift/core"
import type { Category } from "@lift/core"
import { MONTH_COUNT, clampMonthIndex, monthAtIndex, monthHeightAtOffset, monthIndex } from "../calendar/monthPaging"
import { DayWorkoutContent } from "../components/DayWorkoutContent"
import { NotePreview } from "../components/NotePreview"
import { NoteSheet } from "../components/NoteSheet"
import { NavArrowButton } from "../components/NavArrowButton"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { useActiveDateAndSetter } from "../state/activeDate"
import { pressedStyle } from "../theme/pressable"
import { useSettings } from "../settings/SettingsProvider"
import { theme, line, tint } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"
import { todayString, ymd } from "../dates"

const WEEKDAY_LABELS_SUNDAY = ["S", "M", "T", "W", "T", "F", "S"]
const WEEKDAY_LABELS_MONDAY = ["M", "T", "W", "T", "F", "S", "S"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/**
 * The pushed CalendarDate route has a native header, which already clears the
 * status bar; padding the top again there would push the grid down a bar's
 * worth. The Calendar tab has no header, so it still needs the inset.
 */
function ScreenWrap({
  pushed,
  children,
}: {
  pushed: boolean
  children: ReactNode
}) {
  if (pushed) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {children}
      </View>
    )
  }
  return <StaticSafeAreaView>{children}</StaticSafeAreaView>
}

function parseYear(date?: string): number {
  if (date) {
    const y = Number(date.slice(0, 4))
    if (y) return y
  }
  return new Date().getFullYear()
}

function parseMonth(date?: string): number {
  if (date) {
    const m = Number(date.slice(5, 7))
    if (m) return m
  }
  return new Date().getMonth() + 1
}

export function CalendarScreen({ navigation, route }: any) {
  const incomingDate: string | undefined = route?.params?.date
  // Same component, two routes: the bottom tab and the stack push from an
  // exercise's history. Only the pushed one carries a native header.
  const pushed = route?.name === "CalendarDate"
  const { setDate: setActiveDate } = useActiveDateAndSetter()

  // Lazy-init from the incoming date so the very first render already has
  // the correct year/month/selected day. Without this, the screen renders
  // once with today's month, then setState-during-render forces a second
  // render — that second render is what the user sees "fill in".
  const [year, setYear] = useState(() => parseYear(incomingDate))
  const [month, setMonth] = useState(() => parseMonth(incomingDate))
  const [selectedDate, setSelectedDate] = useState<string>(
    () => incomingDate ?? todayString()
  )

  // Defer the day-detail render (which materializes the whole day's workout)
  // until the push/transition animation finishes. The calendar grid + header
  // paint instantly with the slide; the workout list fills in a frame later.
  // Without this, navigating here from an exercise's Records tap blocks the JS
  // thread during the slide and feels like a freeze. The pre-mounted Calendar
  // tab resolves this immediately on app start, so it sees no change.
  const [detailReady, setDetailReady] = useState(false)
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() =>
      setDetailReady(true)
    )
    return () => task.cancel()
  }, [])

  // Apply every incoming date, even if it's the same string as last time.
  // The Calendar tab stays mounted; the user may have paged to another month
  // since the last Open calendar, and skipping that case left the grid there.
  // Clearing the param afterwards prevents a later re-focus from replaying it.
  //
  // On the mount pass there is nothing to apply. The state initialisers above
  // already read `incomingDate`, and the pager mounts at
  // `initialScrollIndex={visibleIndex}`, so the right month is on screen
  // before this effect can run. Re-applying it put a `scrollToIndex` on a
  // list that may not have rendered yet (it is gated on `pageWidth`), plus
  // two setState calls and a setParams, all inside the 120ms slide.
  const appliedOnce = useRef(false)
  useEffect(() => {
    if (!incomingDate) return
    const isMount = !appliedOnce.current
    appliedOnce.current = true
    // Only the tab instance owns the global active date. The pushed instance
    // sits on top of SetLogger / ExerciseDetail, so writing the date here
    // would move the Today tab underneath: popping back to it would land the
    // user on the date they only glanced at, not the day they were logging.
    // freezeOnBlur hides that until the last pop, which made it look like a
    // delayed jump. "Go to date" below is the explicit opt-in.
    if (!pushed) setActiveDate(incomingDate)

    if (isMount) {
      // Clearing the param is still worth doing, so a later re-focus cannot
      // replay it. It just waits for the transition rather than re-rendering
      // in the middle of it.
      const task = InteractionManager.runAfterInteractions(() =>
        navigation.setParams({ date: undefined })
      )
      return () => task.cancel()
    }

    jumpToMonth(monthIndex(parseYear(incomingDate), parseMonth(incomingDate)), false)
    setSelectedDate(incomingDate)
    navigation.setParams({ date: undefined })
  }, [incomingDate])

  const { firstDayOfWeek } = useSettings()
  const snapshot = useStore((s) => s.snapshot)
  const weekdayLabels =
    firstDayOfWeek === 1 ? WEEKDAY_LABELS_MONDAY : WEEKDAY_LABELS_SUNDAY
  // Gated on detailReady alongside DayWorkoutContent: getWorkoutByDateQ fully
  // materializes the day's sets, so running it during the transition would
  // reintroduce the freeze the deferral is meant to remove.
  const selectedGym = useMemo(
    () =>
      detailReady
        ? getWorkoutByDateQ(selectedDate)?.gym?.trim() || null
        : null,
    [snapshot, selectedDate, detailReady]
  )
  const selectedNote = useMemo(
    () => getDayNoteQ(selectedDate),
    [snapshot, selectedDate]
  )

  // Day note popup. Opens read-only — the note is what you came to read — and
  // switches to the input only when you tap Edit.
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteMode, setNoteMode] = useState<"view" | "edit">("view")
  const [noteDraft, setNoteDraft] = useState("")
  const [noteOriginal, setNoteOriginal] = useState("")
  function openNoteViewer() {
    const n = getDayNoteQ(selectedDate)
    setNoteDraft(n)
    setNoteOriginal(n)
    setNoteMode("view")
    setNoteOpen(true)
  }
  // Picking another day drops the popup rather than leaving it open over a
  // note that is no longer the one on screen.
  useEffect(() => {
    setNoteOpen(false)
  }, [selectedDate])

  const todayKey = todayString()

  // Use the platform's pager for continuous, native-thread finger tracking
  // and deceleration. The old fade/swap animation jumped between two offsets.
  const pager = useRef<VirtualizedList<number>>(null)
  const paging = useRef(false)
  // Seeded from the window rather than starting at 0. The month pager only
  // renders once this is known, and the viewport's height is derived from it,
  // so a 0 here means the calendar slides in with an empty, collapsed grid
  // that pops to full size the frame after `onLayout` lands. That pop is the
  // glitch on open.
  //
  // The viewport runs the full width of the screen - neither `pinned` nor
  // `monthViewport` adds horizontal padding - so the window width is not an
  // approximation. `onLayout` still runs and still wins if they disagree.
  const { width: windowWidth } = useWindowDimensions()
  const [pageWidth, setPageWidth] = useState(windowWidth)
  const viewportHeight = useRef(new Animated.Value(0)).current
  const visibleIndex = monthIndex(year, month)
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  const gridPadding = theme.spacing[2]
  const rowHeight = Math.max(0, pageWidth - gridPadding * 2) / 7
  const restingHeight = monthHeightAtOffset(visibleIndex * pageWidth, pageWidth, gridPadding, firstDayOfWeek)
  useLayoutEffect(() => {
    viewportHeight.setValue(restingHeight)
  }, [restingHeight, viewportHeight])

  function commitMonth(index: number) {
    const date = monthAtIndex(index)
    setYear(date.year)
    setMonth(date.month)
  }

  function finishPaging(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!pageWidth || !paging.current) return
    paging.current = false
    const index = clampMonthIndex(Math.round(event.nativeEvent.contentOffset.x / pageWidth))
    viewportHeight.setValue(monthHeightAtOffset(index * pageWidth, pageWidth, gridPadding, firstDayOfWeek))
    // Only the title/selection changes. The visible page, date cells, dots,
    // and native scroll offset all stay exactly where the swipe left them.
    commitMonth(index)
  }

  function jumpToMonth(index: number, animated: boolean) {
    const target = clampMonthIndex(index)
    paging.current = animated && target !== visibleIndex && pageWidth > 0
    pager.current?.scrollToIndex({ index: target, animated: paging.current })
    if (!paging.current) commitMonth(target)
  }

  function changeMonth(delta: number) {
    if (paging.current || !pageWidth) return
    jumpToMonth(visibleIndex + delta, !reduceMotion)
  }

  function goToday() {
    if (paging.current) return
    const date = new Date()
    const target = monthIndex(date.getFullYear(), date.getMonth() + 1)
    jumpToMonth(target, !reduceMotion && Math.abs(target - visibleIndex) === 1)
  }

  const openDay = useCallback((date: string) => {
    setSelectedDate(date)
    // Make this date the "active" target for the global "+" tab too, so a
    // user who picks a calendar day then taps "+" adds to that day. The
    // pushed instance hides the tab bar, so there is no "+" to aim, and
    // writing the date there would drag the Today tab along (see the
    // incoming-date effect above).
    if (!pushed) setActiveDate(date)
  }, [setActiveDate, pushed])

  function openSetLogger(workoutId: number, weId: number) {
    navigation.navigate("SetLogger", { workoutId, weId })
  }

  return (
    <ScreenWrap pushed={pushed}>
      {/* Pinned calendar (header + weekdays + grid). */}
      <View style={styles.pinned}>
        <View style={styles.header}>
          <NavArrowButton
            direction="back"
            accessibilityLabel="Previous month"
            onPress={() => changeMonth(-1)}
          />
          <Pressable onPress={goToday} style={({ pressed }) => [styles.titleWrap, pressedStyle(pressed)]}>
            <Text style={styles.title}>
              {MONTH_NAMES[month - 1]} {year}
            </Text>
          </Pressable>
          <NavArrowButton
            direction="forward"
            accessibilityLabel="Next month"
            onPress={() => changeMonth(1)}
          />
        </View>

        <View style={styles.weekdayRow}>
          {weekdayLabels.map((d, i) => (
            <Text key={i} style={styles.weekday}>{d}</Text>
          ))}
        </View>

        <Animated.View
          style={[
            styles.monthViewport,
            { height: reduceMotion ? restingHeight : viewportHeight },
          ]}
          onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
        >
          {pageWidth > 0 && (
            <VirtualizedList<number>
              key={pageWidth}
              ref={pager}
              initialScrollIndex={visibleIndex}
              getItemCount={() => MONTH_COUNT}
              getItem={(_data, index) => index}
              getItemLayout={(_data, index) => ({ index, length: pageWidth, offset: index * pageWidth })}
              keyExtractor={(index) => String(index)}
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              windowSize={5}
              updateCellsBatchingPeriod={0}
              removeClippedSubviews={false}
              extraData={{ selectedDate, visibleIndex, detailReady, firstDayOfWeek, todayKey }}
              renderItem={({ item: index }) => (
                <MonthPage
                  index={index}
                  width={pageWidth}
                  firstDayOfWeek={firstDayOfWeek}
                  detailReady={detailReady}
                  active={index === visibleIndex}
                  selectedDate={selectedDate}
                  todayKey={todayKey}
                  onOpenDay={openDay}
                />
              )}
              horizontal
              pagingEnabled
              directionalLockEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(event) => {
                if (!reduceMotion) {
                  viewportHeight.setValue(monthHeightAtOffset(
                    event.nativeEvent.contentOffset.x, pageWidth, gridPadding, firstDayOfWeek
                  ))
                }
              }}
              onScrollBeginDrag={() => { paging.current = true }}
              onScrollEndDrag={(event) => {
                // A drag released exactly on a page may have no momentum
                // callback. Unlock navigation in that case as well.
                const { contentOffset, targetContentOffset, velocity } = event.nativeEvent
                const destination = targetContentOffset?.x ?? contentOffset.x
                const atRest = Math.abs(velocity?.x ?? 0) < 0.01
                const onPage = Math.abs(contentOffset.x / pageWidth - Math.round(contentOffset.x / pageWidth)) < 0.001
                if (atRest && onPage && Math.abs(destination - contentOffset.x) < 0.5) {
                  finishPaging(event)
                }
              }}
              onMomentumScrollEnd={finishPaging}
              style={{ height: rowHeight * 6 + gridPadding * 2, flexGrow: 0, flexShrink: 0 }}
            />
          )}
        </Animated.View>
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
              {!!selectedNote.trim() && (
                <Pressable
                  onPress={openNoteViewer}
                  hitSlop={6}
                  unstable_pressDelay={0}
                  style={({ pressed }) => [
                    styles.detailNoteHit,
                    pressed && { opacity: 0.55 },
                  ]}
                >
                  <NotePreview note={selectedNote} style={styles.detailNote} />
                </Pressable>
              )}
            </View>
            <View style={styles.detailActions}>
              {/* AI plan entry point disabled for now.
              <Pressable
                onPress={() =>
                  navigation.navigate("AiPlan", { startDate: selectedDate })
                }
                hitSlop={8}
                style={({ pressed }) => [styles.aiPlanBtn, pressedStyle(pressed)]}
              >
                <Ionicons name="sparkles" size={14} color={theme.colors.foreground} />
                <Text style={styles.goToDateText}>AI</Text>
              </Pressable>
              */}
              <Pressable
                onPress={() => {
                  setActiveDate(selectedDate)
                  // Works in both contexts:
                  //   • Tab instance (Calendar tab inside MainTabs): navigate
                  //     walks up to the parent stack, lands on Main, switches
                  //     the active tab to Today.
                  //   • Stack instance (CalendarDate pushed from ExerciseDetail):
                  //     navigating to "Main" pops both this screen and
                  //     ExerciseDetail off the stack, then switches the tab.
                  navigation.navigate("Main", {
                    screen: "Today",
                    params: { date: selectedDate },
                  })
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
          </View>
          {detailReady && (
            <DayWorkoutContent
              date={selectedDate}
              onPressExercise={openSetLogger}
            />
          )}

        </View>
      </ScrollView>
      <NoteSheet
        visible={noteOpen}
        mode={noteMode}
        title="Day notes"
        placeholder="How did today go?"
        draft={noteDraft}
        original={noteOriginal}
        onChangeDraft={setNoteDraft}
        onEdit={() => setNoteMode("edit")}
        onClose={() => setNoteOpen(false)}
        onSave={() => setDayNote(selectedDate, noteDraft)}
      />
    </ScreenWrap>
  )
}

const MonthPage = memo(function MonthPage({
  index, width, firstDayOfWeek, detailReady, active, selectedDate, todayKey, onOpenDay,
}: {
  index: number
  width: number
  firstDayOfWeek: 0 | 1
  detailReady: boolean
  active: boolean
  selectedDate: string
  todayKey: string
  onOpenDay: (date: string) => void
}) {
  const snapshot = useStore((s) => s.snapshot)
  const { year, month } = monthAtIndex(index)
  const cells = useMemo(() => buildMonthGrid(year, month, firstDayOfWeek), [year, month, firstDayOfWeek])
  const calendar = useMemo(() => detailReady ? getCalendarQ(year, month) : {}, [snapshot, year, month, detailReady])
  const plannedDates = useMemo(() => new Set(detailReady ? getPlannedDatesQ(year, month) : []), [snapshot, year, month, detailReady])
  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={[styles.grid, { width, padding: theme.spacing[2], alignSelf: "flex-start" }]}
    >
      {cells.map((cell, i) => (
        <DayCell
          key={cell.date ?? `blank-${i}`}
          cell={cell}
          cats={cell.date ? calendar[cell.date] : undefined}
          planned={cell.date ? plannedDates.has(cell.date) : false}
          isToday={cell.date === todayKey}
          isSelected={cell.date === selectedDate}
          onOpenDay={onOpenDay}
        />
      ))}
    </View>
  )
})

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
  // Complete the final week without adding empty rows.
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
  return cells
}

const DayCell = memo(function DayCell({
  cell,
  cats,
  planned,
  isToday,
  isSelected,
  onOpenDay,
}: {
  cell: Cell
  cats: Category[] | undefined
  planned: boolean
  isToday: boolean
  isSelected: boolean
  onOpenDay: (date: string) => void
}) {
  const hasWorkout = cats !== undefined
  const isPlannedOnly = planned && (!cats || cats.length === 0)
  const { colors: categoryColors } = useCategoryStyles()

  if (!cell.date) return <View style={styles.cell} />

  function colorFor(c: string): string {
    return categoryColors[c] ?? theme.colors.cat[c] ?? theme.colors.muted
  }

  return (
    <Pressable onPress={() => onOpenDay(cell.date!)} style={styles.cell}>
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
            cats!.slice(0, 4).map((c) => (
              <View key={c} style={[styles.dot, { backgroundColor: colorFor(c) }]} />
            ))
          ) : isPlannedOnly ? (
            <View style={styles.plannedRing} />
          ) : null}
        </View>
      </View>
    </Pressable>
  )
})

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
  monthViewport: {
    overflow: "hidden",
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
    backgroundColor: tint(0.05),
    borderColor: line(0.18),
  },
  cellSelected: {
    backgroundColor: tint(0.10),
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
  detailNoteHit: { paddingVertical: 1 },
  detailNote: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
  detailActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    backgroundColor: tint(0.04),
  },
  aiPlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: tint(0.04),
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
