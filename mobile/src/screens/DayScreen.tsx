import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  formatWeight,
  workoutDurationSeconds,
} from "@lift/core"
import type { Workout, WorkoutExercise } from "@lift/core"
import { Ionicons } from "@expo/vector-icons"
import { Button } from "../components/Button"
import { PrIcon } from "../components/PrIcon"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useCategoryColor } from "../categories/CategoryStylesProvider"
import { useWeightUnit } from "../settings/SettingsProvider"
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

export function DayScreen({ navigation, route }: any) {
  // Date lives in the shared ActiveDate context — that way the global "+"
  // tab reads the same value DayScreen displays, with zero sync lag. Any
  // initial date param wins on first mount.
  const { date, setDate } = useActiveDateAndSetter()
  useEffect(() => {
    if (route?.params?.date) setDate(route.params.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { width: pageWidth } = useWindowDimensions()
  const pagerRef = useRef<ScrollView | null>(null)

  // Long-press a whole exercise card to enter multi-select; tap other cards
  // to add. The selection bar replaces the summary card while active.
  // selectedIds are workout-exercise ids (we.id), not individual set ids.
  // Selection lives at the screen level (not per-page) and is cleared
  // automatically when the date changes via swipe or tap.
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selectionMode = selectedIds.length > 0

  // While a date transition is in flight, the pager is gesture-locked.
  // Two layers, because each catches a different way the spam-glitch
  // sneaks in:
  //   1. `isTransitioning` (state) flips `scrollEnabled` off — blocks
  //      *new* gestures the system would route to this ScrollView.
  //   2. `transitioningRef` is a synchronous guard inside the
  //      momentum-end handler. iOS can fire a queued momentum-end *after*
  //      we set state but before React commits, and the handler's
  //      closure still sees the old state value. The ref always reads
  //      latest, so a duplicate momentum-end is dropped on the floor.
  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitioningRef = useRef(false)

  function shiftDay(delta: number) {
    setDate(shiftDateString(date, delta))
  }

  // The 3-page horizontal pager keeps prev/current/next mounted so the
  // neighbor day's content is visible during the swipe (no black flash).
  // After paging settles on a neighbor we update `date` and recenter to
  // the middle so the user can keep swiping in either direction without
  // hitting an edge.
  //
  // Closure safety: we read `date` from a ref so a stale render's
  // handleMomentumEnd can't shift from yesterday's value when the user
  // swipes faster than React commits.
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  }, [date])

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (transitioningRef.current) return
    const x = e.nativeEvent.contentOffset.x
    if (pageWidth <= 0) return
    const page = Math.round(x / pageWidth)
    if (page === 1) return
    transitioningRef.current = true
    setIsTransitioning(true)
    const delta = page === 0 ? -1 : 1
    setDate(shiftDateString(dateRef.current, delta))
    // No inline scrollTo here — recentering before React commits the new
    // prev/current/next pages flashes the wrong day for one frame. The
    // useLayoutEffect below recenters AFTER commit, before paint.
  }

  // Recenter the pager whenever `date` changes (swipe, route param,
  // "Today" tap, calendar nav). useLayoutEffect runs synchronously after
  // React commits the new pages but before paint, so the scroll snap is
  // invisible — no flash of the neighbor's content.
  useLayoutEffect(() => {
    pagerRef.current?.scrollTo({ x: pageWidth, y: 0, animated: false })
    setSelectedIds([])
    // Unlock on the next frame — the ref guard above is what actually
    // drops queued momentum-end events synchronously, so the state
    // lock just needs to span "React commit + paint" so the user
    // doesn't see a stale page when their next swipe begins. A long
    // timeout here only made the screen feel sluggish.
    const id = requestAnimationFrame(() => {
      transitioningRef.current = false
      setIsTransitioning(false)
    })
    return () => cancelAnimationFrame(id)
  }, [date, pageWidth])

  const toggleSelected = useCallback((weId: number) => {
    setSelectedIds((prev) =>
      prev.includes(weId) ? prev.filter((x) => x !== weId) : [...prev, weId]
    )
  }, [])
  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const prevDate = useMemo(() => shiftDateString(date, -1), [date])
  const nextDate = useMemo(() => shiftDateString(date, 1), [date])

  return (
    <StaticSafeAreaView>
      {/* Pinned date header, never scrolls. */}
      <View style={styles.pinnedHeader}>
        <DateNav date={date} onShift={shiftDay} onToday={() => setDate(todayString())} />
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Start at middle page; subsequent re-centerings are explicit.
        contentOffset={{ x: pageWidth, y: 0 }}
        onMomentumScrollEnd={handleMomentumEnd}
        // Disable horizontal swipe while in selection mode so multi-select
        // taps don't accidentally page the view, and during a date
        // transition so spam-swipes can't stack mid-recenter.
        scrollEnabled={!selectionMode && !isTransitioning}
        keyboardShouldPersistTaps="handled"
        style={styles.pager}
      >
        <View style={{ width: pageWidth }}>
          <DayContent
            date={prevDate}
            navigation={navigation}
            interactive={false}
            selectedIds={[]}
            selectionMode={false}
            onToggleSelected={() => {}}
            onClearSelection={() => {}}
          />
        </View>
        <View style={{ width: pageWidth }}>
          <DayContent
            date={date}
            navigation={navigation}
            interactive={true}
            selectedIds={selectedIds}
            selectionMode={selectionMode}
            onToggleSelected={toggleSelected}
            onClearSelection={clearSelection}
          />
        </View>
        <View style={{ width: pageWidth }}>
          <DayContent
            date={nextDate}
            navigation={navigation}
            interactive={false}
            selectedIds={[]}
            selectionMode={false}
            onToggleSelected={() => {}}
            onClearSelection={() => {}}
          />
        </View>
      </ScrollView>
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
  const workout = useMemo(
    () => (hydrated ? getWorkoutByDateQ(date) : undefined),
    [hydrated, date, snapshot]
  )

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

  return (
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
          {workout && <SummaryStrip workout={workout} />}
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

function SummaryStrip({ workout }: { workout: Workout }) {
  const [pickerOpen, setPickerOpen] = useState(false)

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
          onPress={() => setPickerOpen(true)}
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
      <GymPickerModal
        visible={pickerOpen}
        workout={workout}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  )
}

// Bottom-sheet modal for editing the workout's gym. Shows suggestions
// drawn from `localApi.listGyms()` (saved + previously-typed names).
// Tapping a suggestion fills the input but does not auto-save — gives the
// user a chance to tweak before committing.
function GymPickerModal({
  visible,
  workout,
  onClose,
}: {
  visible: boolean
  workout: Workout
  onClose: () => void
}) {
  const [draft, setDraft] = useState(workout.gym ?? "")
  const [gymNames, setGymNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setDraft(workout.gym ?? "")
    api
      .listGyms()
      .then((gs) => setGymNames(gs.map((g) => g.name)))
      .catch(() => setGymNames([]))
  }, [visible, workout.gym, workout.id])

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return gymNames
    return gymNames.filter((g) => g.toLowerCase().includes(q))
  }, [gymNames, draft])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await api.patchWorkout(workout.id, { gym: draft.trim() })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable style={styles.gymSheetBackdrop} onPress={onClose}>
          <Pressable onPress={() => {}} style={styles.gymSheetCard}>
            <Text style={styles.gymSheetTitle}>Gym</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Where are you working out?"
              placeholderTextColor={theme.colors.muted}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={save}
              style={styles.gymSheetInput}
            />
            {filtered.length > 0 && (
              <ScrollView
                style={styles.gymSheetSuggestList}
                keyboardShouldPersistTaps="handled"
              >
                {filtered.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => setDraft(name)}
                    style={({ pressed }) => [
                      styles.gymSheetSuggestRow,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.gymSheetSuggestText}>{name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.gymSheetActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <Button
                label={saving ? "Saving…" : "Save"}
                onPress={save}
                disabled={saving}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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
  const unit = useWeightUnit()
  const catColor = useCategoryColor(we.exercise.category)
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
      {/* Category-color accent strip running the full height of the card */}
      <View style={[styles.exerciseAccent, { backgroundColor: catColor }]} />

      <View style={styles.exerciseInner}>
        <View style={styles.exerciseHeader}>
          <View style={styles.exerciseTitleWrap}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {we.exercise.name}
            </Text>
            <Text style={[styles.exerciseCategory, { color: catColor }]}>
              {we.exercise.category}
            </Text>
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
            {we.sets.map((s, i) => {
              const isPr = !!s.is_pr
              const wasPr = !s.is_pr && !!s.was_pr
              return (
                <View
                  key={s.id}
                  style={[
                    styles.exSetRow,
                    s.is_planned && styles.exSetRowPlanned,
                  ]}
                >
                  <Text
                    style={[
                      styles.exSetNum,
                      s.is_planned && { color: "rgba(255,255,255,0.30)" },
                      isPr && { color: "#e0c050" },
                    ]}
                  >
                    {i + 1}
                  </Text>
                  <View style={styles.exSetWeightReps}>
                    <Text
                      style={[
                        styles.exSetWeight,
                        s.is_planned && styles.exSetDim,
                      ]}
                    >
                      {formatWeight(s.weight, unit)}
                    </Text>
                    <Text style={styles.exSetUnit}>{unit}</Text>
                    <Text
                      style={[
                        styles.exSetTimes,
                        s.is_planned && { color: "rgba(255,255,255,0.20)" },
                      ]}
                    >
                      ×
                    </Text>
                    <Text
                      style={[
                        styles.exSetReps,
                        s.is_planned && styles.exSetDim,
                      ]}
                    >
                      {s.reps ?? "—"}
                    </Text>
                  </View>
                  <View style={styles.exSetTrailing}>
                    {(isPr || wasPr) && <PrIcon historical={!isPr} />}
                    {s.is_planned && (
                      <Text style={styles.exSetPlannedTag}>plan</Text>
                    )}
                  </View>
                </View>
              )
            })}
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
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
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
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  exerciseTitleWrap: {
    flex: 1,
    gap: 2,
  },
  exerciseName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  exerciseCategory: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.4,
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
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  exSetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 9,
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  exSetRowPlanned: {
    backgroundColor: "rgba(255,255,255,0.012)",
  },
  exSetNum: {
    width: 18,
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  exSetWeightReps: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  exSetWeight: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  exSetUnit: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    marginRight: 2,
  },
  exSetTimes: {
    color: "rgba(255,255,255,0.30)",
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    marginHorizontal: 1,
  },
  exSetReps: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  exSetDim: {
    color: theme.colors.muted,
    fontStyle: "italic",
  },
  exSetTrailing: {
    minWidth: 36,
    alignItems: "flex-end",
  },
  exSetPlannedTag: {
    color: theme.colors.muted,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  exerciseCardSelected: {
    borderColor: theme.colors.foreground,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
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
  gymSheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  gymSheetCard: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[3],
  },
  gymSheetTitle: {
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
  gymSheetSuggestText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  gymSheetActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
})
