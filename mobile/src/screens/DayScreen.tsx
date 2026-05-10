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
  lastSetTimeOf,
  startPlannedWorkout,
  useHydrated,
  useStore,
  getWorkoutByDateQ,
  workoutDurationSeconds,
} from "@lift/core"
import type { Workout, WorkoutExercise } from "@lift/core"
import { Ionicons } from "@expo/vector-icons"
import { useIsFocused } from "@react-navigation/native"
import { Button } from "../components/Button"
import { CategoryPill } from "../components/CategoryPill"
import { SetList } from "../components/SetList"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
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
// `data` array is just integers so the memory cost is trivial — only
// ~3 pages of `DayContent` are rendered at a time thanks to FlatList
// virtualization.
const TOTAL_DAYS = 365 * 6
const INITIAL_INDEX = Math.floor(TOTAL_DAYS / 2)

const noop = () => {}

export function DayScreen({ navigation, route }: any) {
  // Date lives in the shared ActiveDate context — that way the global "+"
  // tab reads the same value DayScreen displays, with zero sync lag. Any
  // initial date param wins on first mount.
  const { date, setDate } = useActiveDateAndSetter()
  // useIsFocused returns false while a stack child (e.g. ExercisePicker) is
  // on top — including during the back-swipe gesture. Gating the horizontal
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
  // horizontal list — every swipe just shifts the FlatList's content
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
  // correct offset — we should not call scrollToOffset again, otherwise
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

  const toggleSelected = useCallback((weId: number) => {
    setSelectedIds((prev) =>
      prev.includes(weId) ? prev.filter((x) => x !== weId) : [...prev, weId]
    )
  }, [])
  const clearSelection = useCallback(() => setSelectedIds([]), [])

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
    ]
  )

  return (
    <StaticSafeAreaView>
      {/* Pinned date header, never scrolls. */}
      <View style={styles.pinnedHeader}>
        <DateNav date={date} onShift={shiftDay} onToday={() => setDate(todayString())} />
      </View>

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
}: {
  date: string
  navigation: any
  interactive: boolean
  selectedIds: number[]
  selectionMode: boolean
  onToggleSelected: (weId: number) => void
  onClearSelection: () => void
}) {
  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)
  const rawWorkout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    [hydrated, date, snapshot]
  )
  // Hide WEs that have no sets yet — they're transient placeholders that only
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
          onPress: async () => {
            for (const weId of selectedIds) {
              await api.removeExerciseFromWorkout(workout.id, weId)
            }
            onClearSelection()
          },
        },
      ]
    )
  }

  const [gymPickerOpen, setGymPickerOpen] = useState(false)

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {selectionMode && interactive ? (
          <View style={styles.selectionBar}>
            <Pressable
              onPress={onClearSelection}
              hitSlop={12}
              style={styles.selectionCancelBtn}
            >
              <Ionicons name="close" size={22} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.selectionCount}>
              {selectedIds.length} selected
            </Text>
            <Pressable
              onPress={confirmDeleteSelected}
              style={({ pressed }) => [
                styles.selectionRemoveBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
              <Text style={styles.selectionRemoveText}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {workout && (
              <SummaryStrip
                workout={workout}
                onOpenPicker={() => setGymPickerOpen(true)}
              />
            )}
            {workout?.status === "planned" && (
              <PlannedBanner date={date} onStart={handleStart} />
            )}
          </>
        )}

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
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No exercises yet. Add one below.</Text>
          </View>
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
  onToday,
}: {
  date: string
  onShift: (delta: number) => void
  onToday: () => void
}) {
  return (
    <View style={styles.dateNav}>
      <Pressable
        onPress={() => onShift(-1)}
        style={({ pressed }) => [
          styles.navBtn,
          { transform: [{ scale: pressed ? 0.85 : 1 }] },
        ]}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
      </Pressable>
      <Pressable onPress={onToday} style={({ pressed }) => [styles.dateLabel, pressedStyle(pressed)]}>
        <Text style={styles.dateText}>{labelForDate(date)}</Text>
      </Pressable>
      <Pressable
        onPress={() => onShift(1)}
        style={({ pressed }) => [
          styles.navBtn,
          { transform: [{ scale: pressed ? 0.85 : 1 }] },
        ]}
        hitSlop={8}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
      </Pressable>
    </View>
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
  onOpenPicker,
}: {
  workout: Workout
  onOpenPicker: () => void
}) {
  // Show start/end/duration whenever the workout has a real `started_at` —
  // that's set when the workout was originally created on its own day. Past
  // workouts that were logged retroactively (createWorkout for a past date)
  // start with started_at=null, so they stay clean. This way, today's
  // recorded times persist into future views forever.
  const hasTime = !!workout.started_at
  const lastTime = hasTime ? lastSetTimeOf(workout) : null
  const started = hasTime ? formatTime(workout.started_at!) : null
  const finished = lastTime ? formatTime(lastTime) : null
  const duration = hasTime ? formatDuration(workoutDurationSeconds(workout)) : null

  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryMetaRow}>
          {started && <SummaryMeta label="Started" value={started} />}
          {finished && <SummaryMeta label="End" value={finished} />}
          {duration && <SummaryMeta label="Duration" value={duration} />}
        </View>
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
      </View>
    </View>
  )
}

// Custom Animated.View overlay (not react-native-modal) for picking
// the workout's gym. Same pattern as SetLogger's NoteEditorSheet —
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
                No gyms yet — tap "Add gym" to create one.
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
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.exerciseCard,
        pressedStyle(pressed && !selectionMode),
        isSelected && styles.exerciseCardSelected,
      ]}
    >
      <View style={styles.exerciseInner}>
        <View style={styles.exerciseHeader}>
          <Text style={styles.exerciseName} numberOfLines={1}>
            {we.exercise.name}
          </Text>
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
            {isSelected && (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={theme.colors.foreground}
              />
            )}
          </View>
        </View>

        {setCount === 0 ? (
          <View style={styles.addFirstWrap}>
            <Text style={styles.addFirst}>+ Add first set</Text>
          </View>
        ) : (
          <View style={styles.exSetList}>
            <SetList sets={we.sets} />
          </View>
        )}
      </View>
    </Pressable>
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
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dateLabel: {
    flex: 1,
    alignItems: "center",
    borderRadius: theme.radius.md,
    paddingVertical: 8,
  },
  dateText: { color: theme.colors.foreground, fontSize: theme.fontSize.md, fontWeight: "700" },
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
  empty: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    padding: theme.spacing[6],
    alignItems: "center",
  },
  emptyText: { color: theme.colors.muted, fontSize: theme.fontSize.sm },
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
  exerciseName: {
    flex: 1,
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
    borderColor: theme.colors.foreground,
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
    ...StyleSheet.absoluteFillObject,
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
