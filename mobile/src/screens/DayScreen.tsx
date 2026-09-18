import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import {
  localApi as api,
  batchMutations,
  lastSetTimeOf,
  startPlannedWorkout,
  useHydrated,
  useStore,
  getState,
  getWorkoutByDateQ,
  getDayNoteQ,
  setDayNote,
  setWorkoutNote,
  deleteWorkout,
  workoutDurationSeconds,
} from "@lift/core"
import type { Workout, WorkoutExercise } from "@lift/core"
import { Ionicons } from "@expo/vector-icons"
import { useIsFocused } from "@react-navigation/native"
import { Button } from "../components/Button"
import { CategoryPill } from "../components/CategoryPill"
import { SetList } from "../components/SetList"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { CollapseIn, FadeHighlight, SlideDownIn } from "../components/Fade"
import { HoldPressable } from "../components/HoldPressable"
import { NativeMenu, type MenuAction } from "../components/NativeMenu"
import { NavArrowButton } from "../components/NavArrowButton"
import { NotePreview } from "../components/NotePreview"
import { NoteSheet } from "../components/NoteSheet"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useActiveDateAndSetter } from "../state/activeDate"

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}
function shiftDateString(date: string, delta: number): string {
  const d = new Date(date + "T00:00:00")
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ~6 year sliding window (3 each side of today). Generous enough that
// the user effectively never hits the edge in normal use, and the
// `data` array is just integers so the memory cost is trivial - only
// ~3 pages of `DayContent` are rendered at a time thanks to FlatList
// virtualization.
const TOTAL_DAYS = 365 * 6
const INITIAL_INDEX = Math.floor(TOTAL_DAYS / 2)

const noop = () => {}

export function DayScreen({ navigation, route }: any) {
  // Date lives in the shared ActiveDate context - that way the global "+"
  // tab reads the same value DayScreen displays, with zero sync lag. Any
  // initial date param wins on first mount.
  const { date, setDate } = useActiveDateAndSetter()
  // useIsFocused returns false while a stack child (e.g. ExercisePicker) is
  // on top - including during the back-swipe gesture. Gating the horizontal
  // pager's scroll on this prevents the tail end of an edge-swipe-back from
  // being caught by the date pager once the picker dismisses.
  const isFocused = useIsFocused()
  useEffect(() => {
    if (route?.params?.date) setDate(route.params.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { width: pageWidth } = useWindowDimensions()

  // Anchor: today as of mount. FlatList index N maps to anchor +
  // (N - INITIAL_INDEX) days. The pager is now a single virtualized
  // horizontal list - every swipe just shifts the FlatList's content
  // offset by one page, no mid-flight recenter. That removes the
  // entire class of spam-swipe bugs the 3-page version had.
  const anchorRef = useRef(todayString())

  const indexForDate = useCallback((d: string) => {
    const a = new Date(anchorRef.current + "T00:00:00")
    const t = new Date(d + "T00:00:00")
    const diff = Math.round((t.getTime() - a.getTime()) / 86400000)
    return INITIAL_INDEX + diff
  }, [])

  const dateForIndex = useCallback(
    (idx: number) => shiftDateString(anchorRef.current, idx - INITIAL_INDEX),
    []
  )

  // Long-press a whole exercise card to enter multi-select; tap other cards
  // to add. selectedIds live at the screen level and clear automatically
  // when the date changes via swipe or tap.
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selectionMode = selectedIds.length > 0

  function shiftDay(delta: number) {
    setDate(shiftDateString(date, delta))
  }

  const flatListRef = useRef<FlatList<number> | null>(null)
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  }, [date])

  // When `date` changes from a swipe, FlatList is *already* at the
  // correct offset - we should not call scrollToOffset again, otherwise
  // a rapid follow-up gesture gets jolted. This flag lets the
  // sync-effect skip swipe-driven changes; only external sources
  // (Today button, calendar nav, route param) trigger a programmatic
  // scroll.
  const swipeInProgressRef = useRef(false)

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pageWidth <= 0) return
    const x = e.nativeEvent.contentOffset.x
    const idx = Math.round(x / pageWidth)
    const newDate = dateForIndex(idx)
    if (newDate === dateRef.current) return
    swipeInProgressRef.current = true
    setDate(newDate)
    requestAnimationFrame(() => {
      swipeInProgressRef.current = false
    })
  }

  // Sync FlatList scroll position to `date` on external changes only.
  // (Selection always clears on a date change, regardless of source.)
  useEffect(() => {
    setSelectedIds([])
    if (swipeInProgressRef.current) return
    if (pageWidth <= 0) return
    const offset = indexForDate(date) * pageWidth
    flatListRef.current?.scrollToOffset({ offset, animated: false })
  }, [date, pageWidth, indexForDate])

  // Re-assert the pager offset whenever the screen regains focus. While the
  // Today tab is inactive its native view is detached, so a scrollToOffset
  // issued by the sync effect above - e.g. when the user picks a date on the
  // Calendar tab, which updates the shared `date` context - is dropped. On
  // re-focus the pager would otherwise stay parked on its previous page
  // (often today) while the header shows the newly selected date. Snapping to
  // the current date's offset here keeps the visible workout in sync.
  useEffect(() => {
    if (!isFocused) return
    if (pageWidth <= 0) return
    const offset = indexForDate(dateRef.current) * pageWidth
    flatListRef.current?.scrollToOffset({ offset, animated: false })
  }, [isFocused, pageWidth, indexForDate])

  const toggleSelected = useCallback((weId: number) => {
    setSelectedIds((prev) =>
      prev.includes(weId) ? prev.filter((x) => x !== weId) : [...prev, weId]
    )
  }, [])
  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const [noteSheetOpen, setNoteSheetOpen] = useState(false)
  const [noteSheetMode, setNoteSheetMode] = useState<"view" | "edit">("view")
  // Which note the one shared sheet is editing: the date's or the session's.
  const [noteKind, setNoteKind] = useState<NoteKind>("day")
  const [noteDraft, setNoteDraft] = useState("")
  const [noteOriginal, setNoteOriginal] = useState("")

  // Changing the date closes the note sheet. The date menu needs no such
  // reset: the system dismisses it on its own, and it is rebuilt from the
  // current date every render.
  useEffect(() => {
    setNoteSheetOpen(false)
  }, [date])

  const openNoteSheet = useCallback(
    (mode: "view" | "edit", kind: NoteKind) => {
      const n =
        kind === "day"
          ? getDayNoteQ(date)
          : getState().indexes.workoutsByDate.get(date)?.notes ?? ""
      setNoteDraft(n)
      setNoteOriginal(n)
      setNoteKind(kind)
      setNoteSheetMode(mode)
      setNoteSheetOpen(true)
    },
    [date]
  )
  const openNoteViewer = useCallback(
    () => openNoteSheet("view", "day"),
    [openNoteSheet]
  )
  const openNoteEditor = useCallback(
    () => openNoteSheet("edit", "day"),
    [openNoteSheet]
  )
  const openWorkoutNoteViewer = useCallback(
    () => openNoteSheet("view", "workout"),
    [openNoteSheet]
  )

  // The system menu has already dismissed by the time this fires, so these run
  // directly. The custom menu needed a setTimeout past its own fade here, or a
  // sheet opened while the menu was still on screen.
  const onDateMenuAction = useCallback(
    (id: string) => {
      if (id === "dayNote") openNoteEditor()
      else if (id === "calendar") {
        // Sibling tab, not a stack push. CalendarScreen already consumes
        // route.params.date and jumps the grid to that day.
        navigation.navigate("Calendar", { date })
      } else if (id === "deleteWorkout") {
        const wid = getState().indexes.workoutsByDate.get(date)?.id ?? null
        if (wid == null) return
        Alert.alert(
          "Delete workout?",
          "All exercises and sets logged this day will be removed. Notes are kept.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => deleteWorkout(wid),
            },
          ]
        )
      }
    },
    [date, navigation, openNoteEditor]
  )

  const data = useMemo(
    () => Array.from({ length: TOTAL_DAYS }, (_, i) => i),
    []
  )

  const getItemLayout = useCallback(
    (_d: ArrayLike<number> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth]
  )

  const keyExtractor = useCallback((item: number) => String(item), [])

  const renderItem = useCallback(
    ({ item }: { item: number }) => {
      const itemDate = dateForIndex(item)
      const isCurrent = itemDate === date
      return (
        <View style={{ width: pageWidth }}>
          <DayContent
            date={itemDate}
            navigation={navigation}
            interactive={isCurrent}
            selectedIds={isCurrent ? selectedIds : []}
            selectionMode={isCurrent ? selectionMode : false}
            onToggleSelected={isCurrent ? toggleSelected : noop}
            onClearSelection={isCurrent ? clearSelection : noop}
            onOpenNotes={isCurrent ? openNoteViewer : noop}
            onOpenWorkoutNotes={isCurrent ? openWorkoutNoteViewer : noop}
          />
        </View>
      )
    },
    [
      date,
      pageWidth,
      selectedIds,
      selectionMode,
      dateForIndex,
      navigation,
      toggleSelected,
      clearSelection,
      openNoteViewer,
      openWorkoutNoteViewer,
    ]
  )

  return (
    <StaticSafeAreaView>
      {/* Pinned date header, never scrolls. */}
      <View style={styles.pinnedHeader}>
        <DateNav
          date={date}
          onShift={shiftDay}
          onSelectAction={onDateMenuAction}
        />
      </View>

      <View style={styles.body}>
        <FlatList
          ref={flatListRef}
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate={0.9}
          disableIntervalMomentum={true}
          scrollEnabled={!selectionMode && isFocused}
          initialScrollIndex={indexForDate(date)}
          onMomentumScrollEnd={handleMomentumEnd}
          keyboardShouldPersistTaps="handled"
          style={styles.pager}
          windowSize={3}
          maxToRenderPerBatch={3}
          initialNumToRender={3}
          removeClippedSubviews={Platform.OS === "android"}
        />

        {/* Floating "Go to today" chip, hovering just above the bottom tab bar
            whenever the viewed day isn't today. */}
        <TodayPill
          visible={date !== todayString()}
          onPress={() => setDate(todayString())}
        />
      </View>
      <NoteSheet
        visible={noteSheetOpen}
        mode={noteSheetMode}
        title={noteKind === "day" ? "Day notes" : "Workout notes"}
        placeholder={
          noteKind === "day" ? "How did today go?" : "How did the session go?"
        }
        draft={noteDraft}
        original={noteOriginal}
        onChangeDraft={setNoteDraft}
        onEdit={() => setNoteSheetMode("edit")}
        onClose={() => setNoteSheetOpen(false)}
        onSave={() => {
          if (noteKind === "day") {
            setDayNote(date, noteDraft)
            return
          }
          const id = getState().indexes.workoutsByDate.get(date)?.id
          if (id != null) setWorkoutNote(id, noteDraft)
        }}
      />
    </StaticSafeAreaView>
  )
}

function DayContent({
  date,
  navigation,
  interactive,
  selectedIds,
  selectionMode,
  onToggleSelected,
  onClearSelection,
  onOpenNotes,
  onOpenWorkoutNotes,
}: {
  date: string
  navigation: any
  interactive: boolean
  selectedIds: number[]
  selectionMode: boolean
  onToggleSelected: (weId: number) => void
  onClearSelection: () => void
  onOpenNotes: () => void
  onOpenWorkoutNotes: () => void
}) {
  // The bar outlives selectionMode so it can play its exit. barCount holds the
  // last real count, or the label would read "0 selected" as it fades out.
  const [barMounted, setBarMounted] = useState(false)
  const [barCount, setBarCount] = useState(0)
  useEffect(() => {
    if (!selectionMode) return
    setBarMounted(true)
    setBarCount(selectedIds.length)
  }, [selectionMode, selectedIds.length])
  // Coming back is the half that was missing. The bar animated out, then the
  // summary strip appeared at full opacity in the same frame - so the exit
  // ended in a pop. stripFade rests at 1 so a normal day view is untouched;
  // only the return from selection animates.
  const stripFade = useRef(new Animated.Value(1)).current
  // Start the timing from an effect, not here: the strip has not mounted at
  // this point, so the native driver would have no node to attach to and the
  // view would land at its final value.
  const [stripEntering, setStripEntering] = useState(false)
  const hideBar = useCallback(() => {
    setBarMounted(false)
    stripFade.setValue(0)
    setStripEntering(true)
  }, [stripFade])
  useEffect(() => {
    if (!stripEntering) return
    setStripEntering(false)
    Animated.timing(stripFade, {
      toValue: 1,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [stripEntering, stripFade])
  // An off-screen pager page unmounts the bar without playing its exit, so
  // onExited never fires. Reset here or the summary strip stays hidden.
  useEffect(() => {
    if (!interactive) setBarMounted(false)
  }, [interactive])

  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)

  const rawWorkout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    [hydrated, date, snapshot]
  )
  // Hide WEs that have no sets yet - they're transient placeholders that only
  // exist while the user is in SetLogger from the picker flow. If a backwards
  // navigation drops them, we don't want a half-second flash of an empty
  // "Add first set" card. The cleanup hook in SetLoggerScreen still purges
  // them from the store, this just gates visibility in the meantime.
  // If filtering leaves the workout with no exercises *and* no other state
  // (gym, started_at, planned), treat the whole workout as not-yet-existing
  // so the SummaryStrip/empty state don't flash either.
  const workout = useMemo(() => {
    if (!rawWorkout) return rawWorkout
    const visibleExercises = rawWorkout.exercises.filter(
      (we) => we.sets.length > 0
    )
    if (
      visibleExercises.length === 0 &&
      !rawWorkout.started_at &&
      !rawWorkout.gym &&
      !rawWorkout.notes &&
      rawWorkout.status !== "planned"
    ) {
      return undefined
    }
    return { ...rawWorkout, exercises: visibleExercises }
  }, [rawWorkout])

  function handleStart() {
    if (!workout || workout.status !== "planned") return
    startPlannedWorkout(workout.id)
  }

  function handlePressExercise(we: WorkoutExercise) {
    if (!workout || !interactive) return
    navigation.navigate("SetLogger", { workoutId: workout.id, weId: we.id })
  }

  function confirmDeleteSelected() {
    if (!workout || selectedIds.length === 0) return
    const count = selectedIds.length
    Alert.alert(
      `Remove ${count} exercise${count === 1 ? "" : "s"}?`,
      "All sets logged for these exercises today will be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            // No await in the loop, and one commit for the batch. localApi
            // resolves against the in-memory snapshot, so awaiting only
            // yields to React between removals — each one then recomputes
            // PRs, rebuilds indexes and re-renders on its own.
            batchMutations(() => {
              for (const weId of selectedIds) {
                api.removeExerciseFromWorkout(workout.id, weId)
              }
            })
            onClearSelection()
          },
        },
      ]
    )
  }

  const [gymPickerOpen, setGymPickerOpen] = useState(false)
  const dayNote = useMemo(
    () => (hydrated ? getDayNoteQ(date) : ""),
    [hydrated, date, snapshot]
  )

  const showSummary = !!(workout || dayNote)
  const showBanner = workout?.status === "planned"

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {barMounted && interactive ? (
          <SelectionBar
            count={barCount}
            active={selectionMode}
            onClear={onClearSelection}
            onRemove={confirmDeleteSelected}
            onExited={hideBar}
          />
        ) : showSummary || showBanner ? (
          // Wrapper carries the scroll container's own gap so the two cards
          // keep their spacing, and is skipped entirely when neither renders -
          // an empty View would still collect the parent's 16px gap.
          <Animated.View
            style={{
              gap: theme.spacing[4],
              opacity: stripFade,
              transform: [
                {
                  translateY: stripFade.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-10, 0],
                  }),
                },
              ],
            }}
          >
            {showSummary && (
              <SummaryStrip
                workout={workout ?? null}
                note={dayNote}
                workoutNote={workout?.notes ?? ""}
                onOpenNotes={onOpenNotes}
                onOpenWorkoutNotes={onOpenWorkoutNotes}
                onOpenPicker={() => setGymPickerOpen(true)}
              />
            )}
            {showBanner && (
              <PlannedBanner date={date} onStart={handleStart} />
            )}
          </Animated.View>
        ) : null}

        {workout && workout.exercises.length > 0 ? (
          <View style={{ gap: theme.spacing[3] }}>
            {workout.exercises.map((we) => {
              const isSelected = interactive && selectedIds.includes(we.id)
              return (
                <ExerciseRow
                  key={we.id}
                  we={we}
                  isSelected={isSelected}
                  selectionMode={selectionMode && interactive}
                  onPress={() => {
                    if (!interactive) return
                    if (selectionMode) onToggleSelected(we.id)
                    else handlePressExercise(we)
                  }}
                  onLongPress={() => {
                    if (!interactive) return
                    if (!isSelected) onToggleSelected(we.id)
                  }}
                />
              )
            })}
          </View>
        ) : (
          <Pressable
            onPress={() => {
              if (interactive) navigation.navigate("ExercisePicker")
            }}
            disabled={!interactive}
            style={({ pressed }) => [
              styles.emptyAdd,
              pressedStyle(pressed && interactive),
            ]}
          >
            <Ionicons name="add-circle" size={56} color={theme.colors.primary} />
            <Text style={styles.emptyAddTitle}>
              {workout ? "Add exercise" : "Add workout"}
            </Text>
            <Text style={styles.emptyAddSub}>
              {workout
                ? "No exercises yet - tap to add one."
                : "No workout logged for this day yet."}
            </Text>
          </Pressable>
        )}
      </ScrollView>
      {workout && interactive && (
        <GymPickerModal
          visible={gymPickerOpen}
          workout={workout}
          onClose={() => setGymPickerOpen(false)}
        />
      )}
    </View>
  )
}

function DateNav({
  date,
  onShift,
  onSelectAction,
}: {
  date: string
  onShift: (delta: number) => void
  onSelectAction: (id: string) => void
}) {
  // The date label opens a system menu, so its items must exist at render
  // time rather than being gathered on press. DateNav subscribes here rather
  // than DayScreen doing it: this component is three buttons, while DayScreen
  // hosts the whole date pager and would re-render all of it.
  const snapshot = useStore((s) => s.snapshot)

  // A system menu needs its items before the press, so this is derived on
  // render instead of gathered in an open handler. It is a few index lookups
  // and it only reruns when the snapshot or the date moves.
  const menuCtx = useMemo(() => {
    const { indexes } = getState()
    const w = indexes.workoutsByDate.get(date)
    let hasExercises = false
    if (w) {
      const wes = indexes.workoutExercisesByWorkout.get(w.id) ?? []
      hasExercises = wes.some(
        (we) => (indexes.setsByWorkoutExercise.get(we.id) ?? []).length > 0
      )
    }
    return {
      note: getDayNoteQ(date),
      hasExercises,
      workoutId: w?.id ?? null,
    }
  }, [snapshot, date])

  const dateMenuActions = useMemo<MenuAction[]>(() => {
    // No separate "remove" item: the editor deletes the note when you clear it
    // and save. `setDayNote` drops the row on empty text, and the sheet treats
    // full-to-empty as a real change, so Save stays enabled.
    const hasNote = !!menuCtx.note.trim()
    const actions: MenuAction[] = [
      {
        id: "dayNote",
        title: noteActionLabel(date, hasNote),
        // No subtitle: the title already says what this does. The old one read
        // "Only this date", which existed to contrast with a workout-note item
        // that is no longer in this menu.
        image: "calendar.badge.plus",
      },
    ]
    actions.push({
      id: "calendar",
      title: "Open calendar",
      image: "calendar",
    })
    if (menuCtx.hasExercises) {
      actions.push({
        id: "deleteWorkout",
        title: "Delete this day's workout",
        image: "trash",
        attributes: { destructive: true },
      })
    }
    return actions
  }, [menuCtx, date])

  return (
    <View style={styles.dateNav}>
      <NavArrowButton
        direction="back"
        accessibilityLabel="Previous day"
        onPress={() => onShift(-1)}
      />
      <NativeMenu
        style={styles.dateMenuAnchor}
        actions={dateMenuActions}
        onSelect={onSelectAction}
      >
        <View style={styles.dateLabel}>
          <Text style={styles.dateText}>{labelForDate(date)}</Text>
          <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
        </View>
      </NativeMenu>
      <NavArrowButton
        direction="forward"
        accessibilityLabel="Next day"
        onPress={() => onShift(1)}
      />
    </View>
  )
}

/** The day screen carries two notes: one on the date, one on the session. */
type NoteKind = "day" | "workout"

function noteActionLabel(date: string, hasNote: boolean): string {
  const t = todayString()
  if (date === t) return hasNote ? "Edit today's note" : "Add a note for today"
  const named = labelForDate(date)
  if (named === "Yesterday") {
    return hasNote ? "Edit yesterday's note" : "Add a note for yesterday"
  }
  if (named === "Tomorrow") {
    return hasNote ? "Edit tomorrow's note" : "Add a note for tomorrow"
  }
  return hasNote ? "Edit this day's note" : "Add a note for this day"
}

function TodayPill({
  visible,
  onPress,
}: {
  visible: boolean
  onPress: () => void
}) {
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 90,
      }).start()
      return
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, anim])

  if (!mounted) return null

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.todayPillWrap,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.todayPill,
          pressed && styles.todayPillPressed,
        ]}
        hitSlop={8}
      >
        <Ionicons name="today-outline" size={14} color={theme.colors.primary} />
        <Text style={styles.todayPillText}>Go to today</Text>
      </Pressable>
    </Animated.View>
  )
}

/**
 * "Today" / "Yesterday" / "Tomorrow" when applicable; otherwise a long
 * weekday + month/day, e.g. "Monday, May 6".
 */
function labelForDate(d: string): string {
  const t = todayString()
  if (d === t) return "Today"
  const today = new Date(t + "T00:00:00")
  const target = new Date(d + "T00:00:00")
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diffDays === -1) return "Yesterday"
  if (diffDays === 1) return "Tomorrow"
  return target.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

function SummaryStrip({
  workout,
  note,
  workoutNote,
  onOpenNotes,
  onOpenWorkoutNotes,
  onOpenPicker,
}: {
  workout: Workout | null
  note: string
  workoutNote: string
  onOpenNotes: () => void
  onOpenWorkoutNotes: () => void
  onOpenPicker: () => void
}) {
  // Show start/end/duration whenever the workout has a real `started_at` -
  // that's set when the workout was originally created on its own day. Past
  // workouts that were logged retroactively (createWorkout for a past date)
  // start with started_at=null, so they stay clean. This way, today's
  // recorded times persist into future views forever.
  const hasTime = !!workout?.started_at
  const lastTime = hasTime && workout ? lastSetTimeOf(workout) : null
  const started = hasTime && workout?.started_at ? formatTime(workout.started_at) : null
  const finished = lastTime ? formatTime(lastTime) : null
  const duration =
    hasTime && workout
      ? formatDuration(workoutDurationSeconds(workout))
      : null

  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryMetaRow}>
          {started && <SummaryMeta label="Started" value={started} />}
          {finished && <SummaryMeta label="End" value={finished} />}
          {duration && <SummaryMeta label="Duration" value={duration} />}
          {!!note && (
            <Pressable
              onPress={onOpenNotes}
              unstable_pressDelay={0}
              // Dim rather than wash: the row runs the width of the meta
              // column, so a background fill reads as a bar across the card.
              style={({ pressed }) => [
                styles.summaryNoteHit,
                pressed && { opacity: 0.55 },
              ]}
              hitSlop={8}
            >
              <Text style={styles.summaryMetaLabel}>Day note</Text>
              <NotePreview note={note} style={styles.summaryNoteLine} />
            </Pressable>
          )}
          {!!workoutNote.trim() && (
            <Pressable
              onPress={onOpenWorkoutNotes}
              unstable_pressDelay={0}
              // Dim rather than wash: the row runs the width of the meta
              // column, so a background fill reads as a bar across the card.
              style={({ pressed }) => [
                styles.summaryNoteHit,
                pressed && { opacity: 0.55 },
              ]}
              hitSlop={8}
            >
              <Text style={styles.summaryMetaLabel}>Workout note</Text>
              <NotePreview note={workoutNote} style={styles.summaryNoteLine} />
            </Pressable>
          )}
        </View>
        {workout && (
          <Pressable
            onPress={onOpenPicker}
            style={({ pressed }) => [styles.summaryGymRow, pressedStyle(pressed)]}
            hitSlop={8}
          >
            <Text style={styles.summaryGymLabel}>📍</Text>
            <Text
              style={[
                styles.summaryGym,
                !workout.gym && { color: theme.colors.muted, fontStyle: "italic" },
              ]}
              numberOfLines={1}
            >
              {workout.gym || "Add gym"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

// Custom Animated.View overlay (not react-native-modal) for picking
// the workout's gym. Same pattern as SetLogger's NoteEditorSheet -
// react-native-modal's keyboard handling caused visible stutter on
// close, and mutations during the exit animation made it appear to
// "double-animate". This implementation runs a single native-driven
// fade and defers store mutations until after the fade completes.
const GYM_FADE_MS = 180
function GymPickerModal({
  visible,
  workout,
  onClose,
}: {
  visible: boolean
  workout: Workout
  onClose: () => void
}) {
  const [gymNames, setGymNames] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [newGym, setNewGym] = useState("")
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)
  const newGymInputRef = useRef<TextInput | null>(null)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setAdding(false)
      setNewGym("")
      api
        .listGyms()
        .then((gs) => setGymNames(gs.map((g) => g.name)))
        .catch(() => setGymNames([]))
      Animated.timing(opacity, {
        toValue: 1,
        duration: GYM_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: GYM_FADE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, opacity])

  const selected = workout.gym

  // Close first, then run the (sync) store mutation after the fade has
  // finished. Mutating during the exit animation re-renders the parent
  // mid-fade and visibly stutters the overlay.
  function deferMutation(fn: () => void) {
    setTimeout(fn, GYM_FADE_MS + 40)
  }

  function selectGym(name: string) {
    Keyboard.dismiss()
    onClose()
    if (name === workout.gym) return
    deferMutation(() => api.patchWorkout(workout.id, { gym: name }))
  }

  function clearGym() {
    Keyboard.dismiss()
    onClose()
    deferMutation(() => api.patchWorkout(workout.id, { gym: "" }))
  }

  function commitNew() {
    const name = newGym.trim()
    if (!name) return
    Keyboard.dismiss()
    const exists = gymNames.some(
      (g) => g.toLowerCase() === name.toLowerCase()
    )
    onClose()
    deferMutation(() => {
      if (!exists) api.createGym(name)
      api.patchWorkout(workout.id, { gym: name })
    })
  }

  function cancelAdd() {
    Keyboard.dismiss()
    setAdding(false)
    setNewGym("")
  }

  function startAdding() {
    setAdding(true)
    // Focus on next frame so the keyboard rises against an already-
    // mounted input rather than racing the layout pass.
    requestAnimationFrame(() => newGymInputRef.current?.focus())
  }

  if (!mounted) return null

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.gymOverlay, { opacity }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.gymOverlayCard} pointerEvents="box-none">
        <Text style={styles.gymOverlayTitle}>Gym</Text>
        {adding ? (
          <>
            <TextInput
              ref={newGymInputRef}
              value={newGym}
              onChangeText={setNewGym}
              placeholder="New gym name"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={commitNew}
              style={styles.gymSheetInput}
            />
            <View style={styles.gymSheetActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={cancelAdd}
                style={{ flex: 1 }}
              />
              <Button
                label="Add"
                onPress={commitNew}
                disabled={!newGym.trim()}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <>
            {gymNames.length === 0 ? (
              <Text style={styles.gymSheetEmpty}>
                No gyms yet - tap "Add gym" to create one.
              </Text>
            ) : (
              <ScrollView
                style={styles.gymSheetSuggestList}
                keyboardShouldPersistTaps="always"
              >
                {gymNames.map((name) => {
                  const isSelected = name === selected
                  return (
                    <Pressable
                      key={name}
                      onPress={() => selectGym(name)}
                      style={({ pressed }) => [
                        styles.gymSheetSuggestRow,
                        pressed && { opacity: 0.7 },
                        isSelected && styles.gymSheetSuggestRowSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.gymSheetSuggestText,
                          isSelected && styles.gymSheetSuggestTextSelected,
                        ]}
                      >
                        {isSelected ? "✓  " : "    "}
                        {name}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            )}
            <View style={styles.gymSheetActions}>
              <Button
                label="Add gym"
                variant="secondary"
                onPress={startAdding}
                style={{ flex: 1 }}
              />
              <Button label="Done" onPress={onClose} style={{ flex: 1 }} />
            </View>
            {workout.gym ? (
              <Button
                label="Clear gym"
                variant="ghost"
                onPress={clearGym}
              />
            ) : null}
          </>
        )}
      </View>
    </Animated.View>
  )
}

function SummaryMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryMetaItem}>
      <Text style={styles.summaryMetaLabel}>{label}</Text>
      <Text style={styles.summaryMetaValue}>{value}</Text>
    </View>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function PlannedBanner({ date, onStart }: { date: string; onStart: () => void }) {
  const today = todayString()
  const isFuture = date > today
  return (
    <View style={[styles.banner, isFuture ? styles.bannerFuture : styles.bannerToday]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.bannerTitle}>
          {isFuture ? "Planned workout" : "You have a planned workout today"}
        </Text>
        <Text style={styles.bannerSub}>
          {isFuture
            ? "Edit targets now; start when the day arrives."
            : "Sets shown are targets, not logged yet."}
        </Text>
      </View>
      {!isFuture && <Button label="Start" onPress={onStart} />}
    </View>
  )
}

function ExerciseRow({
  we,
  onPress,
  onLongPress,
  isSelected,
  selectionMode,
}: {
  we: WorkoutExercise
  onPress: () => void
  onLongPress: () => void
  isSelected: boolean
  selectionMode: boolean
}) {
  const setCount = we.sets.length
  const loggedCount = we.sets.filter((s) => !s.is_planned).length
  const allPlanned = setCount > 0 && loggedCount === 0

  return (
    <HoldPressable
      onPress={onPress}
      onLongPress={selectionMode ? undefined : onLongPress}
      style={({ pressed }) => [
        styles.exerciseCard,
        pressedStyle(pressed && !selectionMode),
      ]}
    >
      <FadeHighlight active={isSelected} style={styles.exerciseCardSelected} />
      <View style={styles.exerciseInner}>
        <View style={styles.exerciseHeader}>
          <View style={styles.exerciseTitleCol}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {we.exercise.name}
            </Text>
            <NotePreview note={we.note} style={styles.exerciseNote} />
          </View>
          <View style={styles.exerciseHeaderRight}>
            {allPlanned && (
              <View style={[styles.setCountChip, styles.setCountChipPlanned]}>
                <Text
                  style={[
                    styles.setCountChipText,
                    { color: theme.colors.muted },
                  ]}
                >
                  {setCount} planned
                </Text>
              </View>
            )}
            <CategoryPill slug={we.exercise.category} />
            {/* Collapses its width instead of unmounting, so the category
             *  pill slides back rather than snapping when you deselect.
             *  width 20 = the icon; gap 8 = exerciseHeaderRight's flex gap. */}
            <CollapseIn active={isSelected} width={20} gap={8}>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={theme.colors.foreground}
              />
            </CollapseIn>
          </View>
        </View>

        {setCount === 0 ? (
          <View style={styles.addFirstWrap}>
            <Text style={styles.addFirst}>+ Add first set</Text>
          </View>
        ) : (
          <View style={styles.exSetList}>
            <SetList sets={we.sets} showNotes />
          </View>
        )}
      </View>
    </HoldPressable>
  )
}

// The multi-select toolbar. It fades and eases down into place when selection
// starts, so the summary strip it replaces does not snap away.
function SelectionBar({
  count,
  active,
  onClear,
  onRemove,
  onExited,
}: {
  count: number
  active: boolean
  onClear: () => void
  onRemove: () => void
  onExited: () => void
}) {
  return (
    <SlideDownIn
      style={styles.selectionBar}
      active={active}
      onExited={onExited}
    >
      <Pressable onPress={onClear} hitSlop={12} style={styles.selectionCancelBtn}>
        <Ionicons name="close" size={22} color={theme.colors.foreground} />
      </Pressable>
      <Text style={styles.selectionCount}>{count} selected</Text>
      <Pressable
        onPress={onRemove}
        style={({ pressed }) => [
          styles.selectionRemoveBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
        <Text style={styles.selectionRemoveText}>Remove</Text>
      </Pressable>
    </SlideDownIn>
  )
}

const styles = StyleSheet.create({
  pinnedHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.background,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  body: {
    flex: 1,
  },
  pager: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scroll: { padding: theme.spacing[4], paddingBottom: 120, gap: theme.spacing[4] },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  // The menu anchor takes the row's middle, the way the old date Pressable
  // did. The arrows are NavArrowButton and carry their own size.
  dateMenuAnchor: { flex: 1 },
  dateLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: theme.radius.md,
    paddingVertical: 8,
  },
  dateText: { color: theme.colors.foreground, fontSize: theme.fontSize.md, fontWeight: "700" },
  todayPillWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.spacing[4],
    alignItems: "center",
    zIndex: 11,
    elevation: 11,
  },
  todayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    // Soft float over the content below.
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  // Opaque press feedback - keep a solid fill (don't drop opacity / swap to a
  // translucent bg) so the content behind never shows through while held.
  todayPillPressed: {
    backgroundColor: theme.colors.cardElevated,
    transform: [{ scale: 0.96 }],
  },
  todayPillText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  summaryCard: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  summaryGymRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  summaryGymLabel: { fontSize: theme.fontSize.sm },
  summaryGym: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  summaryMetaRow: {
    flexDirection: "column",
    gap: 4,
    flex: 1,
  },
  summaryMetaItem: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  summaryMetaLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  summaryMetaValue: { color: theme.colors.foreground, fontSize: theme.fontSize.xs, fontWeight: "600" },
  summaryNoteHit: {
    gap: 4,
    borderRadius: theme.radius.md,
    paddingVertical: 2,
    flexShrink: 1,
  },
  // One line of a note preview. No flexShrink: the style lands on every line
  // inside NotePreview's column, where shrinking squashes their heights
  // instead of narrowing them.
  summaryNoteLine: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    lineHeight: 16,
  },
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
  emptyAdd: {
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    paddingVertical: theme.spacing[10],
    paddingHorizontal: theme.spacing[6],
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: "rgba(0,119,188,0.06)",
  },
  emptyAddTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  emptyAddSub: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  exerciseCard: {
    flexDirection: "row",
    backgroundColor: theme.colors.background,
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  exerciseAccent: {
    width: 4,
    alignSelf: "stretch",
  },
  exerciseInner: {
    flex: 1,
  },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  exerciseTitleCol: { flex: 1, gap: 2 },
  exerciseNote: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
  },
  exerciseName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  exerciseHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  setCountChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  setCountChipPlanned: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  setCountChipText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.3,
  },
  addFirstWrap: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  addFirst: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  exSetList: {
    borderTopColor: "rgba(255,255,255,0.18)",
    borderTopWidth: 1,
  },
  exSetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 8,
    gap: theme.spacing[3],
    borderBottomColor: theme.colors.foreground,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  exSetIcon: { width: 28, alignItems: "flex-start" },
  exPlannedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    borderWidth: 1.5,
  },
  exSetIndex: {
    width: 24,
    color: theme.colors.muted,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  exSetWeight: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textAlign: "center",
  },
  exSetUnit: { color: theme.colors.muted, fontSize: 12, fontWeight: "400" },
  exSetReps: {
    width: 50,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textAlign: "right",
  },
  exerciseCardSelected: {
    ...StyleSheet.absoluteFill,
    borderColor: theme.colors.foreground,
    borderWidth: 1,
    borderRadius: theme.radius.lg - 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.background,
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[3],
  },
  selectionCancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionCount: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  selectionRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: "rgba(239,68,68,0.10)",
  },
  selectionRemoveText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  gymOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 80,
    paddingHorizontal: theme.spacing[4],
    zIndex: 50,
    elevation: 50,
  },
  gymOverlayCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  gymOverlayTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  gymSheetInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  gymSheetSuggestList: {
    maxHeight: 200,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
  },
  gymSheetSuggestRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gymSheetSuggestRowSelected: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  gymSheetSuggestText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  gymSheetSuggestTextSelected: {
    fontWeight: "700",
  },
  gymSheetEmpty: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    paddingVertical: theme.spacing[2],
  },
  gymSheetActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
})
