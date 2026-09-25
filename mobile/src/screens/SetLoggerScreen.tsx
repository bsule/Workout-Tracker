import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  LayoutAnimation,
  type LayoutChangeEvent,
  type ViewStyle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import Svg, { Circle, G, Line as SvgLine, Path as SvgPath, Text as SvgText } from "react-native-svg"
// Use the legacy (non-Reanimated) Swipeable to avoid pulling in
// react-native-reanimated native init at app boot — which is currently
// throwing "Exception in HostFunction" inside Expo Go on this device.
import { Swipeable } from "react-native-gesture-handler"
import { SwipeHold } from "../animation/SwipeHold"
import {
  addExerciseToWorkout,
  batchMutations,
  setExerciseNote,
  createWorkout,
  defaultStep,
  deleteWorkout,
  estimateOneRm,
  formatWeight,
  fromKg,
  getDayNoteQ,
  getExerciseHistoryQ,
  getState,
  getWorkoutByDateQ,
  getWorkoutQ,
  localApi as api,
  logPlannedSet,
  roundForDisplay,
  toKg,
  topRepRecords,
  topRepRecordsByPosition,
  useStore,
} from "@lift/core"
import {
  getExerciseHistorySourceRowsQ,
  sameExerciseHistorySourceRows,
} from "@lift/core/store/queries"
import type {
  ExerciseHistoryDay,
  TopRepRecord,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "@lift/core"
import { PopupModal } from "../components/PopupModal"
import { HoldPressable } from "../components/HoldPressable"
import { MenuButton, MenuPopup, type MenuAction } from "../components/MenuPopup"
import { NotePreview } from "../components/NotePreview"
import { RestTicker } from "../components/RestTicker"
import { NoteReveal } from "../components/NoteReveal"
import { NoteSheet } from "../components/NoteSheet"
import { OverlayCard, overlayCardStyles } from "../components/OverlayCard"
import { SpinChevron } from "../components/SpinChevron"
import {
  ANIM_SLACK_MS,
  DUR,
  EASE,
  NOTE_SHIFT_ANIM,
  SET_ANIM,
  SHIFT_ANIM,
  deferPastAnimation,
  usePresence,
  useExpandToggle,
  useToggleTiming,
} from "../anim"
import { sameHistory } from "../store/sameHistory"
import { predictPrFlags as corePredictPrFlags } from "@lift/core/store/prs"
import { useStableValue } from "../hooks/useStableValue"
import { PrIcon } from "../components/PrIcon"
import { SetList as SharedSetList } from "../components/SetList"
import { pressedStyle } from "../theme/pressable"
import { theme, line, tint } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"
import { agoLabel, niceDate, recordDate, shortDate } from "@lift/core/format"
import {
  isEmptyWorkoutShell,
  lastWorkoutTopSet as coreLastWorkoutTopSet,
} from "@lift/core/workouts"
import {
  cleanNumericText,
  createdAtForRest,
  deleteSetsTitle,
  isCardioCategory,
  lastSessionBefore,
  lastSessionSummary,
  lastTimeCardOpen,
  latestOtherSetIso,
  plannedSetTitle,
  restAnchorForEdit,
  restSecondsFrom,
  setFormError,
  setRestLabels,
} from "@lift/core/setLogger"
import {
  METRIC_OPTIONS,
  REP_ROWS_COLLAPSED,
  REP_SORTS,
  SET_INDEX_OPTIONS,
  chartPoints,
  fmtMetric,
  graphEmptyMessage,
  graphHeaderLabel,
  pastDays,
  pickLastSession,
  repRecordRows,
  setNumbersOf,
  weightRepSets,
  xLabelIndices,
  yAxisScale,
  type ChartPoint,
  type Metric,
  type RepSort,
} from "@lift/core/exerciseStats"
import { lastSetAnchorMs, restTimer, tickerAnchor } from "../restTimer"
import { SubTabBar, type SubTab } from "../components/SubTabBar"


// Predict whether a hypothetical (weight, reps) added to `weId` would be the
// current overall PR / position PR for `exerciseId`, against the live store at
// click time, so the optimistic placeholder can render the gold star on the
// same frame as the click instead of waiting for the (rAF-deferred) mutation
// and a second React commit. The rule itself lives in core's prs.ts, next to
// recomputePrsForExercise, so the preview and the saved flag cannot drift.
function predictPrFlags(
  exerciseId: number,
  weId: number,
  weight: number,
  reps: number
): { isPr: boolean; isPosPr: boolean; position: number } {
  return corePredictPrFlags(getState().indexes, exerciseId, weId, weight, reps)
}

// Animate the next layout change — used right before any mutation that adds or
// removes a set from the list, so the new row eases in and the removed row
// collapses instead of popping. SET_ANIM, the reason it animates scaleXY rather
// than opacity, and the Android enable flag all live in ../anim now.
function animateNext() {
  LayoutAnimation.configureNext(SET_ANIM)
}

// How long the form <-> selection-bar collapse runs. See the note at the
// swap itself.
const SWAP_MS = 240

// How long the enter/leave-edit transition runs. Drives editAnim (border,
// button labels) and the form's height change, so the extra "Rest (sec)"
// field slides in as one motion with the rest of the edit styling.
const EDIT_MS = 280

// The log-set card's `gap`. Needed as a number so the collapsed "Rest (sec)"
// row can cancel it out — see the row itself.
const CARD_GAP = 16

// Height of one NumericField: label (~14) + its 8px gap + the 48px input row.
// Only a fallback — the real height is measured off the Reps field at runtime
// (see fieldHeight). It exists so the rest row can never end up invisible if
// that measurement has not landed yet.
const FIELD_H_FALLBACK = 70

// How long the exercise-note row takes to appear the first time.
const EX_NOTE_REVEAL_MS = DUR.noteReveal

// The "Last time" card's collapse. Height is a layout property, so it runs on
// the JS driver — see the save path, which holds the store mutation back for
// this long when the card is collapsing so the shrink has a clear thread.
const LAST_TIME_COLLAPSE_MS = 150

const EMPTY_HISTORY: ExerciseHistoryDay[] = []

/** For a NoteSheet that opens at the input: there is no "Edit" button to wire. */
function noop() {}

// First-frame placeholder for the editing form. See the use site for the
// derivation of 254. Transparent so the empty card outline doesn't flash
// during the slide; the real form swaps in one rAF later.
// 260 ≈ card padding (40) + border (2) + 2× NumericField (70 each) +
// button row (~44) + 2× inter-child gap (32). Slight overshoot is preferred —
// the ScrollView below absorbs the slack when the real form (typically a
// few px shorter) mounts, so nothing visible shifts.
const FORM_PLACEHOLDER_STYLE = {
  minHeight: 260,
  opacity: 0,
  borderColor: "transparent" as const,
}

// Per-row mount fade. Legacy `Animated` so we don't pull in Reanimated's
// runtime (see import comment). The wrapper sits *outside* the Swipeable so
// our opacity Animated.Value never shares a node with the Swipeable's
// native-driven dragX/progress, sidestepping the JS/native collision that
// LayoutAnimation.opacity hits.
//
// `leaving`: when true, fades the row to 0 (used for delete-then-mutate so
//   the user sees the fade *before* the heavy mutation/commit blocks JS).
function IndexCol({
  display,
  isPr,
  restLabel,
}: {
  display: string | number
  isPr: boolean
  restLabel: string | null
}) {
  const hasLabel = !!restLabel
  const progress = useRef(new Animated.Value(hasLabel ? 0 : 1)).current
  // Mount-once animation: when the rest label is present at first paint,
  // ease the index up and fade the label in beneath it. Re-runs only if a
  // row that started without a label gains one (rare, but cheap to handle).
  useEffect(() => {
    if (!hasLabel) {
      progress.setValue(1)
      return
    }
    progress.setValue(0)
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [hasLabel, progress])
  if (!hasLabel) {
    return (
      <View style={styles.setIndexCol}>
        <Text style={[styles.setIndex, isPr && { color: theme.colors.prText }]}>
          {display}
        </Text>
      </View>
    )
  }
  const indexY = progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] })
  const labelY = progress.interpolate({ inputRange: [0, 1], outputRange: [-3, 0] })
  return (
    <View style={styles.setIndexCol}>
      <Animated.Text
        style={[
          styles.setIndex,
          isPr && { color: theme.colors.prText },
          { transform: [{ translateY: indexY }] },
        ]}
      >
        {display}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.setRestLabel,
          { opacity: progress, transform: [{ translateY: labelY }] },
        ]}
      >
        {restLabel}
      </Animated.Text>
    </View>
  )
}

// TEMPORARY swipe-freeze diagnostics. Remove after the investigation.
const SWIPE_DBG = __DEV__
const dbgT0 = Date.now()
function dbg(msg: string) {
  if (!SWIPE_DBG) return
  console.log(`[swipe-dbg] +${Date.now() - dbgT0}ms ${msg}`)
}

// A handler with a fixed identity that always calls the latest closure.
// The ref is written during render, which this file already relies on for
// SetRowFade's exit callback.
function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}

// Exercise name, category, and the optional note row. Memoized: the parent
// re-renders on every store commit and keystroke, and this block's inputs
// only change when the user renames or annotates the exercise.
const ExerciseHeader = memo(function ExerciseHeader({
  name,
  category,
  note,
  onOpenNote,
}: {
  name: string
  category: string
  note: string
  onOpenNote: () => void
}) {
  return (
    <View style={styles.titleWrap}>
      <Text style={styles.exerciseName}>{name}</Text>
      <Text style={styles.exerciseMeta}>{category}</Text>
      {/* Only when there is something to read. Writing the first one is
          the header menu's job: a standing "Add a note" prompt under
          every exercise name was more chrome than the screen carried. */}
      <NoteReveal note={note}>
        <Pressable onPress={onOpenNote} hitSlop={8} style={styles.exNoteRow}>
          <Ionicons
            name="document-text-outline"
            size={12}
            color={theme.colors.muted}
          />
          {/* The wrapper takes the row's remaining width. exNoteText must
              NOT: it is applied per line inside NotePreview's column,
              where flex:1 makes every line stretch instead of stacking. */}
          <View style={styles.exNoteBody}>
            <NotePreview note={note} style={styles.exNoteText} />
          </View>
        </Pressable>
      </NoteReveal>
      {/* Hidden for the pendingCreate stub, whose id is -1: there is no
       *  workout_exercise row yet, so a note written here would be
       *  dropped without telling the user. The stub is replaced within a
       *  frame or two of the real row landing. */}
    </View>
  )
})

// The form <-> selection-bar swap. Memoized: on a store commit nothing here
// changes, and reconciling two animated layers, three NumericFields, and
// two PhaseButtons was a large share of the post-commit render. Every
// Animated value is a ref the parent owns; every handler is identity-stable.
const LogSetPanel = memo(function LogSetPanel({
  swapAnim,
  swapHeight,
  editAnim,
  restReveal,
  restShown,
  fieldHeight,
  selectionMode,
  selectedCount,
  isCardio,
  unit,
  step,
  weight,
  reps,
  restSec,
  editing,
  showRestTime,
  error,
  onBarLayout,
  onFormLayout,
  onFieldLayout,
  onChangeWeight,
  onChangeReps,
  onChangeRest,
  onSave,
  onClearOrCancel,
  onClearSelection,
  onDeleteSelected,
}: {
  swapAnim: Animated.Value
  swapHeight: Animated.AnimatedInterpolation<number> | null
  editAnim: Animated.Value
  restReveal: Animated.Value
  restShown: boolean
  fieldHeight: number
  selectionMode: boolean
  selectedCount: number
  isCardio: boolean
  unit: "kg" | "lb"
  step: number
  weight: number
  reps: number
  restSec: number
  editing: boolean
  showRestTime: boolean
  error: string | null
  onBarLayout: (e: LayoutChangeEvent) => void
  onFormLayout: (e: LayoutChangeEvent) => void
  onFieldLayout: (e: LayoutChangeEvent) => void
  onChangeWeight: (v: number) => void
  onChangeReps: (v: number) => void
  onChangeRest: (v: number) => void
  onSave: () => void
  onClearOrCancel: () => void
  onClearSelection: () => void
  onDeleteSelected: () => void
}) {
  // The form side of this wrapper's height comes from the form's own
  // measured height (see onFormLayout in the parent), not a constant, so
  // entering edit mode grows the card instead of clipping its buttons. Both
  // layers stay mounted the whole time, absolutely positioned on top of each
  // other, and cross-fade via swapAnim: only their opacity and this
  // wrapper's height ever change, so nothing below this card re-lays out.
  return (
    <Animated.View
      style={[
        { overflow: "hidden" },
        swapHeight != null && { height: swapHeight },
      ]}
    >
      <Animated.View
        onLayout={onBarLayout}
        pointerEvents={selectionMode ? "auto" : "none"}
        style={[
          styles.card,
          styles.selectionBar,
          styles.swapLayer,
          { opacity: swapAnim, zIndex: selectionMode ? 2 : 1 },
        ]}
      >
        <Pressable
          onPress={onClearSelection}
          hitSlop={12}
          style={styles.selectionCancelBtn}
        >
          <Ionicons name="close" size={22} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.selectionCount}>{selectedCount} selected</Text>
        <Pressable
          onPress={onDeleteSelected}
          style={({ pressed }) => [
            styles.selectionDeleteBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={theme.colors.destructive}
          />
          <Text style={styles.selectionDeleteText}>Delete</Text>
        </Pressable>
      </Animated.View>

      <Animated.View
        onLayout={onFormLayout}
        pointerEvents={selectionMode ? "none" : "auto"}
        style={[
          styles.card,
          {
            opacity: swapAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
            zIndex: selectionMode ? 1 : 2,
          },
        ]}
      >
        {/* Absolute overlay that fades a white border in/out. Using
         *  opacity (native-supported) keeps everything on the native
         *  driver, avoiding the JS/native mixing error. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.cardEditBorder, { opacity: editAnim }]}
        />
        <NumericField
          label={
            isCardio
              ? editing ? "Time (editing)" : "Time"
              : editing ? "Weight (editing)" : "Weight"
          }
          unit={isCardio ? "min" : unit}
          value={weight}
          step={isCardio ? 1 : step}
          min={0}
          onChange={onChangeWeight}
          allowDecimal
        />
        <View onLayout={onFieldLayout}>
          <NumericField
            label={isCardio ? "Level" : "Reps"}
            value={reps}
            step={1}
            min={0}
            onChange={onChangeReps}
          />
        </View>
        {showRestTime && (
          // Stays mounted and collapses to height 0 rather than
          // unmounting, so entering and leaving edit mode animates. The
          // negative margin cancels the card's `gap` while the row is
          // collapsed, so a hidden row adds nothing to the card.
          // fieldHeight comes from the Reps field (see the parent).
          <Animated.View
            pointerEvents={restShown ? "auto" : "none"}
            style={{
              overflow: "hidden",
              opacity: restReveal,
              height: restReveal.interpolate({
                inputRange: [0, 1],
                outputRange: [0, fieldHeight || FIELD_H_FALLBACK],
              }),
              marginTop: restReveal.interpolate({
                inputRange: [0, 1],
                outputRange: [-CARD_GAP, 0],
              }),
            }}
          >
            <NumericField
              label="Rest (sec)"
              value={restSec}
              step={5}
              min={0}
              onChange={onChangeRest}
            />
          </Animated.View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <PhaseButton
            defaultLabel="Save"
            altLabel="Update"
            phase={editAnim}
            onPress={onSave}
            style={{ flex: 1 }}
          />
          <PhaseButton
            defaultLabel="Clear"
            altLabel="Cancel"
            phase={editAnim}
            variant="secondary"
            onPress={onClearOrCancel}
            style={{ flex: 1 }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  )
})

function SetRowFade({
  children,
  leaving,
  onExited,
  parentHandlesExit = false,
}: {
  children: ReactNode
  leaving?: boolean
  onExited?: () => void
  parentHandlesExit?: boolean
}) {
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const collapse = useRef(new Animated.Value(1)).current
  const exitCallback = useRef(onExited)
  exitCallback.current = onExited
  const exitFinished = useRef(false)
  const finishExit = useCallback(() => {
    if (exitFinished.current) return
    exitFinished.current = true
    dbg("row collapse done")
    exitCallback.current?.()
  }, [])
  const opacity = useRef(new Animated.Value(0)).current
  // Small translateY so rows visibly settle into / lift out of place
  // instead of just changing opacity in a fixed slot. Distance is kept
  // tiny (6px) so it reads as polish, not a slide.
  const translateY = useRef(new Animated.Value(6)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
    // Mount only: the fade-in belongs to the row's first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!leaving || parentHandlesExit || measuredHeight == null) return
    dbg("row collapse start (JS-driven height)")
    // Own the row's layout instead of relying on configureNext, which can
    // be consumed by another animated card's layout pass.
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(collapse, {
        toValue: 0,
        duration: 280,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
    ])
    animation.start(({ finished }) => {
      if (finished) finishExit()
    })
    return () => animation.stop()
  }, [leaving, parentHandlesExit, measuredHeight, opacity, collapse, finishExit])
  // A tab change or navigation can unmount an exiting row. Still commit
  // its requested deletion even when the animation is no longer visible.
  useEffect(() => () => {
    if (leaving) finishExit()
  }, [leaving, finishExit])
  return (
    <Animated.View
      pointerEvents={leaving ? "none" : "auto"}
      style={leaving && !parentHandlesExit && measuredHeight != null
        ? { height: Animated.multiply(collapse, measuredHeight), overflow: "hidden" }
        : undefined}
    >
      <Animated.View
        onLayout={(event) => {
          if (!leaving) setMeasuredHeight(event.nativeEvent.layout.height)
          else if (measuredHeight == null) setMeasuredHeight(event.nativeEvent.layout.height)
        }}
        style={[
          leaving && !parentHandlesExit && measuredHeight != null ? { height: measuredHeight } : undefined,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        {children}
      </Animated.View>
    </Animated.View>
  )
}
// Metric, METRIC_OPTIONS and SET_INDEX_OPTIONS live in @lift/core/exerciseStats
// so the web graph offers the same choices.

export function SetLoggerScreen({ route, navigation }: any) {
  // `resolved` holds the real workoutId / weId once they exist in the
  // snapshot. We avoid mutating on screen entry (which would force a
  // post-slide buildIndexes + subscriber-emit + re-render hitch) by
  // resolving in two ways without ever doing a mutation here:
  //   1. Synchronously: if a workout already exists for `date` and
  //      already contains this exercise, reuse those ids on the very
  //      first render — read-only, no mutation, no index rebuild.
  //   2. Lazily inside the first Save: the create + addExercise
  //      mutations land in the same rAF callback that already defers
  //      `addSet`, batched into one index rebuild. The user has paused
  //      to type weight/reps when this runs, so the cost is off the
  //      screen-entry critical path entirely. Backing out without saving
  //      means no mutation ever happened — the beforeRemove cleanup
  //      below naturally no-ops because workoutId stays -1.
  // Until either path resolves, the stub UI synthesized from
  // `pendingCreate` is what the user sees and interacts with.
  const [resolved, setResolved] = useState<{
    workoutId: number
    weId: number
  } | null>(() => {
    const p = route.params
    if (p?.workoutId != null && p?.weId != null) {
      return { workoutId: p.workoutId, weId: p.weId }
    }
    if (p?.pendingCreate) {
      const existing = getWorkoutByDateQ(p.pendingCreate.date)
      if (existing) {
        const we = existing.exercises.find(
          (e: WorkoutExercise) => e.exercise.id === p.pendingCreate.exerciseId
        )
        if (we) return { workoutId: existing.id, weId: we.id }
      }
    }
    return null
  })
  // One-shot flag flipped on the first frame after mount. Used to keep
  // non-first-paint subtrees (e.g. the always-mounted note sheet)
  // out of the very first render, so native-stack can start the push
  // animation as soon as possible after navigation.replace.
  const [firstPaintDone, setFirstPaintDone] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setFirstPaintDone(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const workoutId = resolved?.workoutId ?? -1
  const weId = resolved?.weId ?? -1
  const unit = useWeightUnit()
  const step = defaultStep(unit)
  const {
    showOneRm,
    showPositionPrs,
    showRestTime,
    showTimeSinceLastSet,
    showLastTime,
  } = useSettings()
  const [tab, setTab] = useState<SubTab>("workout")

  const snapshot = useStore((s) => s.snapshot)
  // While `resolved` is null we render a stub workout/we synthesized from
  // the picker's `pendingCreate` payload — the real workoutId/weId land
  // ~one frame after the push animation finishes (see the
  // InteractionManager defer above), and showing the populated header +
  // form during the slide-in is what makes the transition feel instant.
  // For a fresh exercise add the stub is visually identical to what the
  // post-mutation render produces (no logged sets), so the swap is
  // imperceptible.
  const realWorkout = useMemo(
    () => (resolved ? getWorkoutQ(workoutId) : null),
    [snapshot, workoutId, resolved]
  )
  const realWe = realWorkout?.exercises.find((e) => e.id === weId)
  const stubFromPending = useMemo<{
    workout: Workout
    we: WorkoutExercise
  } | null>(() => {
    if (resolved) return null
    const p = route.params?.pendingCreate
    if (!p) return null
    const stubWe: WorkoutExercise = {
      id: -1,
      order: 0,
      note: "",
      exercise: {
        id: p.exerciseId,
        name: p.exerciseName,
        category: p.exerciseCategory,
        kind: "weight_reps",
        is_custom: false,
      },
      sets: [],
    }
    const stubWorkout: Workout = {
      id: -1,
      date: p.date,
      status: "active",
      started_at: null,
      finished_at: null,
      duration_seconds: null,
      gym: "",
      notes: "",
      exercises: [stubWe],
      created_at: new Date().toISOString(),
    }
    return { workout: stubWorkout, we: stubWe }
  }, [resolved, route.params?.pendingCreate])
  const workout = realWorkout ?? stubFromPending?.workout ?? null
  const we = realWe ?? stubFromPending?.we
  const sets = we?.sets ?? []
  const isPlanned = workout?.status === "planned"
  const exerciseId = we?.exercise.id ?? null
  // Cardio exercises store their two numerics as time-in-minutes (in the
  // `weight` field) and a level integer (in the `reps` field). No kg/lb
  // conversion is applied for cardio.
  const isCardio = isCardioCategory(we?.exercise.category)
  // Lazy: only run the history query when a tab that needs it is active.
  // The query iterates indexes and is fast, but it runs inside the same
  // synchronous React commit triggered by add/delete-set mutations, where
  // every saved millisecond delays the new row's fade-in start.
  const needsHistory =
    tab === "history" ||
    tab === "graph" ||
    tab === "summary" ||
    // The workout tab's "Last time" card reads history as well. Gated on
    // firstPaintDone so the push animation and the first commit still pay
    // nothing for the query — only later commits do, and none at all when
    // the card is switched off.
    (tab === "workout" && firstPaintDone && showLastTime)
  // Source row references stay the same when an unrelated exercise or a
  // setting changes. A target set's PR flags also replace its row, so this
  // invalidates for historical PR changes as well as new/deleted sets.
  const rawHistorySources = useMemo(
    () => exerciseId != null && needsHistory
      ? getExerciseHistorySourceRowsQ(exerciseId)
      : [],
    [snapshot, exerciseId, needsHistory]
  )
  const historySources = useStableValue(rawHistorySources, sameExerciseHistorySourceRows)
  const rawHistory: ExerciseHistoryDay[] = useMemo(() => {
    if (exerciseId == null || !needsHistory) return EMPTY_HISTORY
    return getExerciseHistoryQ(exerciseId)
  }, [historySources, exerciseId, needsHistory])
  // Identity-stable while the content is unchanged, so LastTimePanel,
  // GraphPanel, and SummaryPanel skip their render on commits that did not
  // touch this exercise's history (a set edit elsewhere, a note, a sync).
  const history = useStableValue(rawHistory, sameHistory)

  // Latest non-planned set timestamp from any *other* exercise in the current
  // workout. Used for both the per-row rest labels (gated by showRestTime) and
  // the live "since last set" ticker (gated by showTimeSinceLastSet), so this
  // is always computed regardless of those flags.
  //
  // Important: during the stub phase (resolved is null), `workout` is a
  // synthetic placeholder containing only the pending exercise. We look up
  // the real workout from the snapshot by date so the bench → pushdowns
  // hand-off still surfaces the prior exercise's last-set timestamp before
  // the user saves their first pushdown set.
  const prevWorkoutLastSetIso = useMemo<string | null>(() => {
    const date = workout?.date ?? route.params?.pendingCreate?.date ?? null
    if (!date) return null
    const realByDate = getWorkoutByDateQ(date)
    if (!realByDate) return null
    const skipWeId = realWe?.id ?? null
    return latestOtherSetIso(realByDate.exercises, skipWeId)
  }, [snapshot, workout?.date, route.params?.pendingCreate?.date, realWe?.id])

  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet

  // Seed each field independently, as before, but query the prior session at
  // most once when either field needs a fallback. Runs only on mount.
  const [initialForm] = useState(() => {
    const top = (seed?.weight == null || seed?.reps == null) && exerciseId != null
      ? coreLastWorkoutTopSet(getExerciseHistoryQ(exerciseId), workout?.date ?? null)
      : null
    const storedWeight = seed?.weight ?? top?.weight ?? (isCardio ? 20 : 0)
    return {
      weight: isCardio
        ? storedWeight
        : roundForDisplay(fromKg(storedWeight, unit), unit),
      reps: seed?.reps ?? top?.reps ?? (isCardio ? 5 : 8),
    }
  })
  const [weight, setWeight] = useState(initialForm.weight)
  const [reps, setReps] = useState(initialForm.reps)
  const [error, setError] = useState<string | null>(null)
  // When non-null, Save updates this set instead of adding a new one. Set
  // by the row's swipe-Edit action, or by "Not Hit" on a planned set.
  const [editingSetId, setEditingSetId] = useState<number | null>(null)
  // Rest-time editing (only meaningful while editingSetId is set and the
  // user has rest-time display enabled). `editingRestAnchorIso` is the
  // previous-anchor used to compute rest; null means there's nothing to
  // anchor on (set 1 of the first exercise of the day) and the field is
  // hidden. `editingOriginalRestSec` lets save() skip the timestamp patch
  // when the user didn't touch the field.
  const [restSec, setRestSec] = useState<number>(0)
  const [editingRestAnchorIso, setEditingRestAnchorIso] = useState<string | null>(null)
  const [editingOriginalRestSec, setEditingOriginalRestSec] = useState<number>(0)
  // When non-null, the planned-set actions modal is open for this set.
  const [activePlannedSet, setActivePlannedSet] = useState<WorkoutSet | null>(
    null
  )
  // Multi-select state. A long-press on a logged set enters selection mode;
  // subsequent taps on other sets toggle their selection. The top of the
  // screen swaps from the form to a selection action bar while active.
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selectionMode = selectedIds.length > 0

  // Optimistic add: a placeholder row that mounts (and starts its fade-in)
  // *before* api.addSet runs, so the user sees feedback on the same frame as
  // the Save click instead of waiting for the heavy mutation/commit. SetList
  // renders the placeholder as a real SetRow and, once the real row lands,
  // renders that row under the placeholder's key, so the instance and its
  // fade-in carry on and nothing swaps. `baseIds` snapshots the set ids at
  // click time, which is how the new row is detected even if a concurrent
  // delete keeps `sets.length` unchanged.

  // The planned-set save path has no `pendingAdd` placeholder: the row is
  // already in `sets`, it just flips from planned to logged when the mutation
  // commits. Holding the id lets the record card count that set as logged on
  // the click frame, and stop counting it the moment `sets` agrees - so it is
  // never counted twice.
  const [optimisticPlannedId, setOptimisticPlannedId] = useState<number | null>(
    null
  )

  const [pendingAdd, setPendingAdd] = useState<{
    weight: number
    reps: number
    key: number
    baseLen: number
    baseIds: Set<number>
    isPr: boolean
    isPosPr: boolean
    position: number
    planned: boolean
  } | null>(null)
  const pendingAddRef = useRef(pendingAdd)
  useEffect(() => {
    pendingAddRef.current = pendingAdd
  }, [pendingAdd])

  // The delete commit and the re-render behind it block JS. A swipe on
  // another row that releases inside that window sits frozen mid-swipe until
  // JS is free, so the commit waits while any row is being dragged.
  const swipeHold = useRef(new SwipeHold()).current
  useEffect(() => {
    swipeHold.activate()
    return () => swipeHold.dispose()
  }, [swipeHold])
  // TEMPORARY: JS thread stall monitor and per-render timer.
  const dbgRenderStart = Date.now()
  useLayoutEffect(() => {
    const ms = Date.now() - dbgRenderStart
    if (ms > 8) dbg(`screen render+commit ${ms}ms`)
  })
  useEffect(() => {
    if (!SWIPE_DBG) return
    let last = Date.now()
    let raf = 0
    const tick = () => {
      const now = Date.now()
      const gap = now - last
      if (gap > 40) dbg(`JS stall ${gap}ms`)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // On leave, if the user never logged a set on this exercise, drop the
  // empty WE so it doesn't litter the day's view as a ghost "Add first set"
  // card. We hook `beforeRemove` (not the unmount cleanup) so the store
  // mutation lands *before* the back-transition animation starts —
  // otherwise DayScreen flashes the empty card for the duration of the
  // animation. If the exercise was the only thing on a freshly-created
  // workout (no gym, no started_at, not planned), delete the workout too.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      // Deletes still held for a swipe must land before the checks below.
      swipeHold.flush()
      if (pendingAddRef.current) return
      const w = getWorkoutQ(workoutId)
      if (!w) return
      const currentWe = w.exercises.find((e) => e.id === weId)
      if (!currentWe) return
      // Subtract sets that are mid-fade for delete — they're functionally
      // gone, the api.deleteSet just hasn't fired yet. Without this, leaving
      // the screen during the 180ms fade window leaves the workout/WE
      // orphaned (the cleanup check sees a non-empty WE, the deferred
      // deleteSet runs after we're gone).
      const leaving = leavingIdsRef.current
      const effectiveLen = currentWe.sets.filter((s) => !leaving.has(s.id)).length
      if (effectiveLen > 0) return
      const isOnlyExercise = w.exercises.length === 1
      const isSideEffectWorkout = isOnlyExercise && isEmptyWorkoutShell(w)
      if (isSideEffectWorkout) {
        deleteWorkout(workoutId)
      } else {
        api.removeExerciseFromWorkout(workoutId, weId)
      }
    })
    return unsub
  }, [navigation, workoutId, weId, swipeHold])

  const showSummaryTab = useCallback(() => setTab("summary"), [])

  /**
   * Every date tap on this screen opens a calendar of its own, pushed on top
   * of the stack. None of them jump to the Calendar tab.
   *
   * A tab jump pops SetLogger and unfreezes every pre-mounted tab on the same
   * frame, which reads as a freeze before the calendar appears, and it leaves
   * you in the tab rather than over the workout you were looking at. A push
   * keeps MainTabs frozen, so the calendar opens at once and the workout is
   * still underneath when you go back.
   *
   * The History tab used to jump. It was the last one that did.
   *
   * Stable identity, so HistoryDayCard's `onPressDate` does not change on an
   * unrelated re-render and force the memoised day cards to re-render mid
   * scroll.
   */
  const openCalendarAtDate = useCallback(
    (date: string) => {
      navigation.navigate("CalendarDate", { date })
    },
    [navigation]
  )

  // Drop the placeholder as soon as the real row lands. SetList already
  // renders the real row under the placeholder's key, so this is state
  // cleanup only: the row instance and its fade-in are not touched.
  useEffect(() => {
    if (!pendingAdd) return
    const baseIds = pendingAdd.baseIds
    if (sets.some((s) => !baseIds.has(s.id))) setPendingAdd(null)
  }, [sets, pendingAdd])

  // Keep rows mounted until their height has collapsed, then commit the
  // batch once so store recomputation cannot interrupt the visible motion.
  const [leavingIds, setLeavingIds] = useState<Set<number>>(() => new Set())
  const leavingIdsRef = useRef(leavingIds)
  const deleteCompletions = useRef(new Map<number, () => void>())
  const finishRowDelete = useCallback((id: number) => {
    deleteCompletions.current.get(id)?.()
  }, [])
  function startDelete(id: number) {
    startDeleteMany([id])
  }

  function startDeleteMany(requestedIds: number[]) {
    const ids = [...new Set(requestedIds)].filter((id) => !leavingIdsRef.current.has(id))
    if (ids.length === 0) return
    dbg(`delete tap ids=${ids.join(",")}`)
    if (editingSetId != null && ids.includes(editingSetId)) cancelEdit()
    const remaining = new Set(ids)
    for (const id of ids) {
      deleteCompletions.current.set(id, () => {
        if (!remaining.delete(id) || remaining.size > 0) return
        if (swipeHold.busy) dbg(`commit held, swipe in flight ids=${ids.join(",")}`)
        swipeHold.run(() => {
          // Prune the ref only. The store emit below re-renders the screen
          // once with the rows gone from `sets`; a setLeavingIds here would
          // land on a second React lane and render the whole screen again.
          // A stale id left in the state matches no rendered row, and the
          // state catches up from the ref on the next delete.
          const next = new Set(leavingIdsRef.current)
          for (const deletedId of ids) {
            next.delete(deletedId)
            deleteCompletions.current.delete(deletedId)
          }
          leavingIdsRef.current = next
          const c0 = Date.now()
          batchMutations(() => {
            for (const deletedId of ids) api.deleteSet(deletedId)
          })
          dbg(`store commit ${Date.now() - c0}ms ids=${ids.join(",")}`)
        })
      })
    }
    const next = new Set(leavingIdsRef.current)
    for (const id of ids) next.add(id)
    leavingIdsRef.current = next
    setLeavingIds(next)
  }

  // Note editor sheet state. Triggered by the "Note" swipe action on a row.
  const [noteEditingSet, setNoteEditingSet] = useState<WorkoutSet | null>(null)
  const [noteDraft, setNoteDraft] = useState("")
  function openNoteEditor(s: WorkoutSet) {
    setNoteEditingSet(s)
    setNoteDraft(s.note ?? "")
  }
  function closeNoteEditor() {
    // Don't clear noteDraft here. Doing so empties the TextInput during
    // the modal's fade-out and the user sees the text visibly vanish
    // before the modal disappears — reads as a flicker. The draft gets
    // overwritten on the next open by openNoteEditor.
    setNoteEditingSet(null)
  }
  function persistNote() {
    if (!noteEditingSet) return
    const id = noteEditingSet.id
    const note = noteDraft.trim()
    // The row grows or shrinks by the note line's height. This animates that,
    // and the shift of every row below it; the note line's own fade-in is
    // NoteReveal's (see NOTE_SHIFT_ANIM on why `create` is left out).
    LayoutAnimation.configureNext(NOTE_SHIFT_ANIM)
    api.updateSet(id, { note }).catch(() => {})
  }

  // Note about this exercise on this day. Separate from a set's own note and
  // from the session note on the workout.
  const [exNoteOpen, setExNoteOpen] = useState(false)
  const [exNoteMode, setExNoteMode] = useState<"view" | "edit">("view")
  const [exNoteDraft, setExNoteDraft] = useState("")
  function openExerciseNote() {
    const n = we?.note ?? ""
    setExNoteDraft(n)
    // Read the note first, edit on demand. An empty note has nothing to read,
    // so that case still opens straight into the input.
    setExNoteMode(n.trim() ? "view" : "edit")
    setExNoteOpen(true)
  }
  function persistExerciseNote() {
    if (!we) return
    // Grows the header, which pushes the form and the set list down.
    LayoutAnimation.configureNext(NOTE_SHIFT_ANIM)
    setExerciseNote(we.id, exNoteDraft)
  }

  // A note needs a real workout_exercise row to hang on. On the pendingCreate
  // path that row lands right after the first set is saved, so until then the
  // header menu's note item is disabled and says why.
  const exNoteShown = (we?.id ?? -1) > 0

  // The overflow menu's button lives in the native header, beside the back
  // button. The card itself is rendered with the screen's other popups, not
  // here: a Modal presented from a navigation-bar subview is a corner the app
  // has no reason to sit in, and the button only has to set a flag.
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)

  const headerMenuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "note",
        title: we?.note.trim() ? "Edit exercise note" : "Add exercise note",
        // Before the first set there is no workout_exercise row to hang a
        // note on, so a note written then would be dropped silently. The
        // subtitle says why instead of the row just vanishing.
        subtitle: exNoteShown ? undefined : "Log a set first",
        icon: "document-text-outline",
        disabled: !exNoteShown,
      },
      {
        id: "lastTime",
        title: showLastTime ? "Hide Last time card" : "Show Last time card",
        icon: showLastTime ? "eye-off-outline" : "eye-outline",
      },
    ],
    [we?.note, exNoteShown, showLastTime]
  )

  function onHeaderMenuAction(id: string) {
    if (id === "note") openExerciseNote()
    else if (id === "lastTime") {
      api.updateSettings({ show_last_time: !showLastTime })
    }
  }

  // The button never changes, so the header is set once. It used to be rebuilt
  // on every note edit and every Last time toggle, because the menu's items
  // hung off it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setHeaderMenuOpen(true)}
          unstable_pressDelay={0}
          hitSlop={8}
          accessibilityLabel="More"
          style={({ pressed }) => [
            styles.headerMenuBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={theme.colors.foreground}
          />
        </Pressable>
      ),
    })
  }, [navigation])

  // Smooth edit-mode transition. Single Animated.Value, fully native-driven
  // (scale + opacity). The "white border while editing" effect is done via
  // an absolute-positioned overlay whose opacity rides this value — mixing
  // native + JS drivers on the same Animated.View throws "JS driven
  // animation on animated node that has been moved to native" at runtime
  // (borderColor isn't natively animatable, but opacity is). Native driver
  // also makes the transition immune to the SetList re-render that fires
  // right after setEditingSetId(null).
  const editAnim = useRef(new Animated.Value(0)).current
  useToggleTiming(editAnim, editingSetId != null, {
    inMs: EDIT_MS,
    easeIn: EASE.inOut,
  })

  function startEdit(s: WorkoutSet) {
    // No LayoutAnimation here: it made every set row in the list animate
    // too, which felt like a freeze. The form's own height change (the
    // "Rest (sec)" field appearing) is animated by formHeightAnim instead,
    // which is scoped to the form's wrapper.
    setEditingSetId(s.id)
    setWeight(
      isCardio
        ? s.weight ?? 0
        : roundForDisplay(fromKg(s.weight ?? 0, unit), unit)
    )
    setReps(s.reps ?? 0)
    // Rest anchor: the most recent non-planned set before this one in the
    // current exercise, falling back to the prior-exercise iso passed in.
    const anchor = restAnchorForEdit(sets, s.id, prevWorkoutLastSetIso)
    setEditingRestAnchorIso(anchor)
    const computed = restSecondsFrom(anchor, s.created_at)
    setRestSec(computed)
    setEditingOriginalRestSec(computed)
    setError(null)
    setTab("workout")
  }

  function cancelEdit() {
    setEditingSetId(null)
    setEditingRestAnchorIso(null)
    setError(null)
  }

  // 0 = form showing, 1 = selection bar showing. Drives the collapse below:
  // both the form and the bar stay mounted the whole time (see the swap
  // itself for why), so this is the only thing that needs to change on
  // selectionMode's transitions.
  const swapAnim = useRef(new Animated.Value(selectionMode ? 1 : 0)).current
  // Measured height of the selection bar. Starts at a reasonable guess;
  // corrected by the bar's own onLayout before the user can ever trigger a
  // collapse, since the bar is mounted (off to the side, opacity 0) from the
  // screen's first paint.
  const [barHeight, setBarHeight] = useState(64)

  const swapMounted = useRef(false)

  useEffect(() => {
    // Nothing to swap on the first paint, and running it would pin the
    // wrapper to the placeholder height before the form has ever laid out.
    if (!swapMounted.current) {
      swapMounted.current = true
      return
    }
    // Entering selection hides the form without unmounting it (see the swap
    // itself), so a focused NumericField would otherwise leave the keyboard
    // up over an invisible input.
    if (selectionMode) Keyboard.dismiss()
    // Pin the wrapper to the form's current height for the collapse: an
    // animated height needs a number on both ends.
    setSwapFromHeight(formHeightRef.current)
    const anim = Animated.timing(swapAnim, {
      toValue: selectionMode ? 1 : 0,
      duration: SWAP_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false, // height can't run on the native driver
    })
    anim.start(({ finished }) => {
      // Back on the form: hand the height back to layout so the form can
      // grow and shrink on its own again.
      if (finished && !selectionMode) setSwapFromHeight(null)
    })
    return () => anim.stop()
    // swapAnim is a stable ref; re-running this on every render would
    // restart the animation from its current position each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode])

  // Explicit height for the swap wrapper, or null for "auto".
  //
  // Auto is the resting state, and it is what keeps the form and the set list
  // in step: the form is a normal flow child, so when it grows or shrinks the
  // wrapper and everything below it move in the same layout pass. Driving the
  // wrapper off the form's *measured* height instead left the list a beat
  // behind — the form re-laid out at once, and the wrapper only caught up
  // after onLayout had reported the new height.
  //
  // A number is only needed for the form <-> selection-bar collapse, which
  // runs between two known heights. It holds the form's height at the moment
  // the collapse starts, and goes back to null once the wrapper settles back
  // on the form.
  const [swapFromHeight, setSwapFromHeight] = useState<number | null>(null)
  // Latest laid-out height of the form. The form keeps its natural height
  // even while the wrapper clips it (a flow child does not shrink to fit a
  // shorter parent), so this stays right across a collapse.
  const formHeightRef = useRef(FORM_PLACEHOLDER_STYLE.minHeight)

  function onFormLayout(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h > 0) formHeightRef.current = h
  }

  const swapHeight = useMemo(
    () =>
      swapFromHeight == null
        ? null
        : swapAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [swapFromHeight, barHeight],
          }),
    [swapFromHeight, barHeight, swapAnim]
  )

  // Set position the next save would take, 1-based. 1 means nothing is logged
  // for this exercise today, which is what puts the record card in "Last time"
  // mode; 2 and up put it in position mode.
  //
  // Deliberately derived from `sets`, never from `history`. `history` is a memo
  // over the snapshot, and the snapshot only moves when the store mutation
  // commits - which on the first set of the day is held back 230ms on purpose.
  // Reading `sets` instead lets the card swap on the click frame, alongside the
  // new row's fade-in.
  //
  // The filter matches predictPrFlags and prs.ts: planned sets and sets with no
  // weight/reps pair take no position.
  const nextPosition = useMemo(() => {
    let logged = 0
    for (const s of sets) {
      if (s.is_planned || s.weight == null || s.reps == null) continue
      // A set mid-delete is functionally gone: the row is fading and the
      // api.deleteSet call is queued behind that fade. Counting it would hold
      // the card on the old position until the mutation lands 180ms later, so
      // the card would move *after* the row had vanished, and its height
      // animation would start on the same frame as the delete's PR recompute
      // and index rebuild. Dropping it here moves the card with the fade
      // instead, and leaves the heavy commit a clear thread afterwards.
      if (leavingIds.has(s.id)) continue
      logged++
    }
    // `pendingAdd` clears one render after the real row lands. Count it only
    // while the real row has yet to land, so that render never double-counts.
    if (
      pendingAdd?.baseIds &&
      !sets.some((s) => !pendingAdd.baseIds.has(s.id))
    ) {
      logged++
    }
    // Planned-set path: count the row until `sets` reports it logged.
    if (
      optimisticPlannedId != null &&
      sets.some((s) => s.id === optimisticPlannedId && s.is_planned)
    ) {
      logged++
    }
    return logged + 1
  }, [sets, pendingAdd, optimisticPlannedId, leavingIds])

  // Editing an existing set does not change what comes next, so the card holds
  // still. Without this it jumps as a side effect of tapping a row, which reads
  // as a bug.
  const frozenPosition = useRef(nextPosition)
  if (editingSetId == null) frozenPosition.current = nextPosition
  const displayPosition =
    editingSetId != null ? frozenPosition.current : nextPosition

  // The "Rest (sec)" field only exists while editing a set that has a rest
  // anchor. It unfolds instead of popping in, so the card's height change and
  // the set list's shift are one motion, on editAnim's clock.
  const restShown =
    editingSetId != null && showRestTime && editingRestAnchorIso != null
  const restReveal = useRef(new Animated.Value(0)).current
  // Height the rest row unfolds to. It is measured off the Reps field, not
  // off the rest row itself: the rest row lives inside a clipped, height-0
  // wrapper when hidden, and a child in there never reports a usable height.
  // Reps is always on screen and is the same NumericField shape (label, no
  // unit), so its height is the rest row's height.
  const [fieldHeight, setFieldHeight] = useState(0)

  useToggleTiming(restReveal, restShown, {
    inMs: EDIT_MS,
    easeIn: EASE.inOut,
    native: false, // height can't run on the native driver
  })

  function onFieldLayout(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h > 0) setFieldHeight((prev) => (prev === h ? prev : h))
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function clearSelection() {
    setSelectedIds([])
  }

  // Row callbacks with a fixed identity. SetList and SetRow are memoized, so
  // a fresh closure per render would re-render every row on every keystroke
  // in the form and on every store commit.
  const onRowLongPress = useStableCallback((s: WorkoutSet) => {
    if (s.is_planned) return
    if (!selectedIds.includes(s.id)) toggleSelected(s.id)
  })
  const onRowSelectToggle = useStableCallback(toggleSelected)
  const onRowPlannedTap = useStableCallback((s: WorkoutSet) => setActivePlannedSet(s))
  const onRowEdit = useStableCallback(startEdit)
  const onRowAddNote = useStableCallback(openNoteEditor)
  const onRowDelete = useStableCallback((s: WorkoutSet) => startDelete(s.id))
  const onOpenExerciseNote = useStableCallback(openExerciseNote)
  // LogSetPanel is memoized; these keep its callback props identity-stable.
  const onSave = useStableCallback(save)
  const onClearOrCancel = useStableCallback(() => {
    if (editingSetId != null) {
      cancelEdit()
    } else {
      setWeight(0)
      setReps(0)
      setError(null)
    }
  })
  const onClearSelection = useStableCallback(clearSelection)
  const onDeleteSelected = useStableCallback(confirmDeleteSelected)
  const onBarLayout = useStableCallback((e: LayoutChangeEvent) =>
    setBarHeight(e.nativeEvent.layout.height)
  )
  const onFormLayoutStable = useStableCallback(onFormLayout)
  const onFieldLayoutStable = useStableCallback(onFieldLayout)

  function confirmDeleteSelected() {
    if (selectedIds.length === 0) return
    const count = selectedIds.length
    Alert.alert(
      deleteSetsTitle(count),
      "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const ids = [...selectedIds]
            clearSelection()
            startDeleteMany(ids)
          },
        },
      ]
    )
  }

  if (!we || !workout) {
    // Reached when the route was given a workoutId/weId that no longer
    // exists in the snapshot. The pendingCreate handoff path always
    // synthesizes a stub `we`/`workout`, so it never lands here.
    return (
      <View style={[styles.flex, { padding: theme.spacing[4] }]}>
        <Text style={{ color: theme.colors.muted }}>Exercise not found.</Text>
      </View>
    )
  }

  // Starts or restarts the rest timer outside the app (Lock Screen, Dynamic
  // Island, Android notification). Fire and forget. Only for a set that is
  // logged, not an edit of a logged set or a planned set being authored.
  function startRestTimer(atMs: number) {
    if (we) restTimer.setLogged(we.exercise.name, atMs)
  }

  function save() {
    Keyboard.dismiss()
    setError(null)
    const formError = setFormError(weight, reps, isCardio)
    if (formError) {
      setError(formError)
      return
    }
    try {
      if (editingSetId != null) {
        // Editing requires `resolved` (you can't edit a set that doesn't
        // exist yet). Bail otherwise.
        if (!resolved) return
        // Flip the form back to add-mode FIRST so the editAnim effect kicks
        // off the border-color/scale transition, then defer the mutation
        // past the whole transition — not just one frame. The store update
        // forces a PR recompute and a full SetList re-render, which blocks
        // JS for longer than a frame, and the card's collapse is a height
        // animation, so it runs on the JS driver and stalls with it. One
        // frame of headroom was enough for the native-driven border but not
        // for the collapse: Save snapped shut while Cancel (no mutation)
        // animated. Same trick as the note editor's handleSave.
        const w = isCardio ? weight : toKg(weight, unit)
        const r = reps
        const id = editingSetId
        // Editing a planned set via "Not Hit" logs it (flips is_planned to
        // false) with the new values in a single mutation.
        const editingPlanned = sets.find((s) => s.id === id)?.is_planned === true
        // If the user changed the rest field, recompute this set's
        // created_at as anchor + restSec. Skipped when there's no anchor or
        // the value is unchanged.
        const anchor = editingRestAnchorIso
        const restChanged = anchor != null && restSec !== editingOriginalRestSec
        const newCreatedAt = restChanged && anchor
          ? createdAtForRest(anchor, restSec)
          : null
        setEditingSetId(null)
        setEditingRestAnchorIso(null)
        const loggedAt = Date.now()
        if (editingPlanned) startRestTimer(loggedAt)
        setTimeout(() => {
          if (editingPlanned) {
            logPlannedSet(id, { weight: w, reps: r, created_at: new Date(loggedAt).toISOString() })
          } else {
            api.updateSet(id, {
              weight: w,
              reps: r,
              ...(newCreatedAt ? { created_at: newCreatedAt } : {}),
            })
          }
        }, EDIT_MS + ANIM_SLACK_MS)
      } else if (isPlanned) {
        // isPlanned only true for an existing planned workout — already resolved.
        if (!resolved) return
        // Same optimistic-placeholder flow for planned-set authoring so the
        // fade starts on click instead of after the mutation commits.
        const w = isCardio ? weight : toKg(weight, unit)
        const r = reps
        setPendingAdd({
          weight: w,
          reps: r,
          key: Date.now(),
          baseLen: sets.length,
          baseIds: new Set(sets.map((s) => s.id)),
          isPr: false,
          isPosPr: false,
          position: 0,
          planned: true,
        })
        requestAnimationFrame(() => {
          api.addPlannedSet(weId, { weight: w, reps: r })
        })
      } else {
        const queued = sets.find((s) => s.is_planned)
        if (queued) {
          // Logging against a planned set: same row, fade weight/reps update
          // would be jarring — skip animation.
          setOptimisticPlannedId(queued.id)
          // One timestamp for the row and the timer outside the app.
          const loggedAt = Date.now()
          startRestTimer(loggedAt)
          logPlannedSet(queued.id, {
            weight: isCardio ? weight : toKg(weight, unit),
            reps,
            created_at: new Date(loggedAt).toISOString(),
          })
        } else {
          // Optimistic placeholder: render an immediate fading-in row so the
          // user sees the row on the same frame as the click, then defer the
          // store mutation to the next frame so the heavy commit doesn't
          // block the fade from starting.
          const w = isCardio ? weight : toKg(weight, unit)
          const r = reps
          const pr =
            resolved && exerciseId != null
              ? predictPrFlags(exerciseId, resolved.weId, w, r)
              : { isPr: false, isPosPr: false, position: 0 }
          // The record card may change height on this save, and its height
          // animation runs on the JS driver, so the store commit - PR
          // recompute, index rebuild, full list re-render - is held back past
          // it whenever the card is on screen. Nothing visible waits: the
          // placeholder row is already up from the click frame.
          //
          // This used to fire only on the first set, because that was the
          // card's one height change per session. It no longer is. Since the
          // rows box sizes itself to the record count, any swap between
          // positions with different counts moves the card, and the swap into
          // a position with no record is the biggest of those. Gating on the
          // first set alone left every later resize to collide with the
          // commit and snap. A deferral on a save that turns out not to move
          // the card costs ~190ms of store latency and nothing on screen.
          const cardMayResize = showLastTime
          // One timestamp for the placeholder row (the in-app ticker's
          // anchor) and the timer outside the app, so the two agree.
          const savedAt = Date.now()
          startRestTimer(savedAt)
          setPendingAdd({
            weight: w,
            reps: r,
            key: savedAt,
            baseLen: sets.length,
            baseIds: new Set(sets.map((s) => s.id)),
            isPr: pr.isPr,
            isPosPr: pr.isPosPr,
            position: pr.position,
            planned: false,
          })
          // Capture resolved at click time. If still null, this is the
          // first save on a brand-new workout/exercise — lazy-create the
          // workout + WE inside the same rAF as addSet so all three
          // mutations coalesce into a single index rebuild + subscriber
          // emit. The user already saw the placeholder fade-in start on
          // the click frame, so the heavy work landing one frame later is
          // invisible.
          const wasResolved = resolved
          const pending = route.params?.pendingCreate
          // Without the record card, one frame is enough of a head start.
          // With it, it is not: the card may be animating its height on the
          // JS driver, and this commit — PR recompute,
          // index rebuild, full list re-render — would stall it half way. Hold
          // it back past the collapse instead. Nothing visible waits on it:
          // the placeholder row is already on screen from the click frame.
          // Same trick as the edit-mode save above.
          // The row keeps the time of the tap, not of this deferred commit:
          // the in-app ticker counts from it, and so does the timer outside
          // the app (startRestTimer above).
          const createdAt = new Date(savedAt).toISOString()
          const runMutation = () => {
            if (wasResolved) {
              api.addSet(wasResolved.weId, { weight: w, reps: r, created_at: createdAt })
              return
            }
            if (!pending) return
            const ids = batchMutations(() => {
              const existing = getWorkoutByDateQ(pending.date)
              const wid = existing?.id ?? createWorkout(pending.date).row.id
              const we = addExerciseToWorkout(wid, pending.exerciseId)
              return { workoutId: wid, weId: we.id }
            })
            // This commit is where the exercise-note row first mounts,
            // which pushes the form and the set list down by a row. Only
            // `update` is configured: the shift animates natively, while
            // newly created views (the note row, the new set row) are left
            // alone so they keep their own fade-ins.
            LayoutAnimation.configureNext(SHIFT_ANIM)
            setResolved(ids)
            api.addSet(ids.weId, { weight: w, reps: r, created_at: createdAt })
          }
          if (cardMayResize) {
            deferPastAnimation(runMutation, LAST_TIME_COLLAPSE_MS)
          } else {
            requestAnimationFrame(runMutation)
          }
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to save set")
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Fixed header + form so the layout doesn't reflow when sets are added.
       *  Pressable wrapper so a tap on empty form-area background dismisses
       *  the keyboard — the numeric keypad has no return key, so without
       *  this the user has to drag the list to dismiss. */}
      <Pressable style={styles.fixedTop} onPress={() => Keyboard.dismiss()}>
        <ExerciseHeader
          name={we.exercise.name}
          category={we.exercise.category}
          note={we.note}
          onOpenNote={onOpenExerciseNote}
        />

        {tab === "workout" && !firstPaintDone && (
          // First-frame placeholder. Reserves the form's vertical space so the
          // slide-in silhouette doesn't shift when the real form mounts one
          // rAF later. iOS native-stack waits for the destination's first
          // commit before starting the push animation; gating the form (two
          // NumericFields + two PhaseButtons + the editAnim Animated.Value
          // interpolations) behind firstPaintDone keeps the first commit
          // trivial so the slide begins as soon as possible after the tap.
          // Height derivation lives on FORM_PLACEHOLDER_STYLE.
          <View style={[styles.card, FORM_PLACEHOLDER_STYLE]} />
        )}
        {tab === "workout" && firstPaintDone && (
          <LogSetPanel
            swapAnim={swapAnim}
            swapHeight={swapHeight}
            editAnim={editAnim}
            restReveal={restReveal}
            restShown={restShown}
            fieldHeight={fieldHeight}
            selectionMode={selectionMode}
            selectedCount={selectedIds.length}
            isCardio={isCardio}
            unit={unit}
            step={step}
            weight={weight}
            reps={reps}
            restSec={restSec}
            editing={editingSetId != null}
            showRestTime={showRestTime}
            error={error}
            onBarLayout={onBarLayout}
            onFormLayout={onFormLayoutStable}
            onFieldLayout={onFieldLayoutStable}
            onChangeWeight={setWeight}
            onChangeReps={setReps}
            onChangeRest={setRestSec}
            onSave={onSave}
            onClearOrCancel={onClearOrCancel}
            onClearSelection={onClearSelection}
            onDeleteSelected={onDeleteSelected}
          />
        )}
      </Pressable>

      {tab === "history" ? (
        <PastHistoryList
          style={styles.contentScroll}
          contentContainerStyle={styles.listScrollContent}
          days={history}
          currentDate={workout.date}
          onPressDate={openCalendarAtDate}
        />
      ) : (
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.listScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {tab === "workout" && firstPaintDone && (
            <SetList
              sets={sets}
              unit={unit}
              isCardio={isCardio}
              showOneRm={showOneRm}
              showPositionPrs={showPositionPrs}
              showRestTime={showRestTime}
              showTimeSinceLastSet={showTimeSinceLastSet}
              prevWorkoutLastSetIso={prevWorkoutLastSetIso}
              exerciseName={we.exercise.name}
              workoutDate={workout.date}
              selectedIds={selectedIds}
              pendingAdd={pendingAdd}
              leavingIds={leavingIds}
              onDeleteExited={finishRowDelete}
              swipeHold={swipeHold}
              onLongPress={onRowLongPress}
              onSelectToggle={onRowSelectToggle}
              onPlannedTap={onRowPlannedTap}
              onEdit={onRowEdit}
              onAddNote={onRowAddNote}
              onDelete={onRowDelete}
            />
          )}
          {tab === "workout" && firstPaintDone && showLastTime && (
            <LastTimePanel
              days={history}
              currentDate={workout.date}
              unit={unit}
              nextPosition={displayPosition}
              isWeightReps={we.exercise.kind === "weight_reps"}
              onPressDate={openCalendarAtDate}
              onShowMore={showSummaryTab}
            />
          )}
          {tab === "graph" && <GraphPanel days={history} unit={unit} />}
          {tab === "summary" && (
            <SummaryPanel
              days={history}
              unit={unit}
              onPressDate={openCalendarAtDate}
              excludeDate={workout.date}
            />
          )}
          {tab === "settings" && <SettingsPanel navigation={navigation} />}
        </ScrollView>
      )}

      {/* Gated on firstPaintDone so the bar's 5 Pressables + Ionicons aren't
       *  on the first commit. The bar is at the bottom edge — the last pixels
       *  to slide into view — so mounting it one rAF later is invisible. */}
      {firstPaintDone && <SubTabBar tab={tab} onChange={setTab} />}
      {/* Gated on firstPaintDone so the Modal's host-view allocation isn't on
       *  the critical path of the slide-in. The Modal is invisible during the
       *  push animation anyway; mounting it one frame later is imperceptible. */}
      {firstPaintDone && (
        <NoteSheet
          visible={noteEditingSet != null}
          // A set note opens straight at the input: the row already shows the
          // note text, so there is nothing to read here first.
          mode="edit"
          title="Note"
          placeholder="Add a note for this set…"
          original={noteEditingSet?.note ?? ""}
          draft={noteDraft}
          onChangeDraft={setNoteDraft}
          onEdit={noop}
          onClose={closeNoteEditor}
          onSave={persistNote}
        />
      )}
      {firstPaintDone && (
        <NoteSheet
          visible={exNoteOpen}
          original={we.note}
          draft={exNoteDraft}
          onChangeDraft={setExNoteDraft}
          onClose={() => setExNoteOpen(false)}
          onSave={persistExerciseNote}
          title="Exercise note"
          placeholder="How this exercise went today"
          mode={exNoteMode}
          onEdit={() => setExNoteMode("edit")}
        />
      )}
      {/* The overflow menu (a system alert). Its button is in the native
          header; see the headerRight effect above. */}
      <MenuPopup
        visible={headerMenuOpen}
        onClose={() => setHeaderMenuOpen(false)}
        actions={headerMenuActions}
        onSelect={onHeaderMenuAction}
      />
      <PlannedSetActionsModal
        set={activePlannedSet}
        unit={unit}
        isCardio={isCardio}
        onClose={() => setActivePlannedSet(null)}
        onHit={(s) => {
          setActivePlannedSet(null)
          const w = s.weight
          const r = s.reps
          if (w == null || r == null) return
          const loggedAt = Date.now()
          startRestTimer(loggedAt)
          requestAnimationFrame(() => {
            logPlannedSet(s.id, { weight: w, reps: r, created_at: new Date(loggedAt).toISOString() })
          })
        }}
        onNotHit={(s) => {
          setActivePlannedSet(null)
          requestAnimationFrame(() => startEdit(s))
        }}
        onDelete={(s) => {
          setActivePlannedSet(null)
          requestAnimationFrame(() => startDelete(s.id))
        }}
      />
    </View>
  )
}

// Tap-to-act menu for a planned set. Hit logs at planned values, Not Hit
// drops the top form into edit mode for the planned set, Delete removes it.
function PlannedSetActionsModal({
  set,
  unit,
  isCardio,
  onClose,
  onHit,
  onNotHit,
  onDelete,
}: {
  set: WorkoutSet | null
  unit: "kg" | "lb"
  isCardio: boolean
  onClose: () => void
  onHit: (s: WorkoutSet) => void
  onNotHit: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const title =
    set != null ? plannedSetTitle(set, unit, isCardio) : ""
  return (
    <PopupModal
      visible={set != null}
      title={title}
      onClose={onClose}
    >
      <Pressable
        onPress={() => set && onHit(set)}
        style={({ pressed }) => [
          styles.plannedActionBtn,
          styles.plannedActionHit,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="checkmark"
          size={16}
          color={theme.colors.secondary}
        />
        <Text style={[styles.plannedActionLabel, { color: theme.colors.secondary }]}>
          Hit
        </Text>
      </Pressable>
      <Pressable
        onPress={() => set && onNotHit(set)}
        style={({ pressed }) => [
          styles.plannedActionBtn,
          styles.plannedActionNotHit,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="create-outline"
          size={16}
          color={theme.colors.foreground}
        />
        <Text style={[styles.plannedActionLabel, { color: theme.colors.foreground }]}>
          Not hit
        </Text>
      </Pressable>
      <Pressable
        onPress={() => set && onDelete(set)}
        style={({ pressed }) => [
          styles.plannedActionBtn,
          styles.plannedActionDelete,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="trash-outline"
          size={16}
          color={theme.colors.destructive}
        />
        <Text style={[styles.plannedActionLabel, { color: theme.colors.destructive }]}>
          Delete
        </Text>
      </Pressable>
    </PopupModal>
  )
}

// Two-state action button whose label cross-fades when `phase` (an
// Animated.Value 0..1) animates. Used in the editing form so the Save↔Update
// and Clear↔Cancel labels transition together with the surrounding card's
// border-color/scale animation, instead of snapping when state flips.
function PhaseButton({
  defaultLabel,
  altLabel,
  phase,
  variant = "primary",
  onPress,
  style,
}: {
  defaultLabel: string
  altLabel: string
  phase: Animated.Value
  variant?: "primary" | "secondary"
  onPress?: () => void
  style?: any
}) {
  const fg = theme.colors.foreground
  const border =
    variant === "secondary" ? theme.colors.borderStrong : theme.colors.foreground
  const fadeOut = phase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  })
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.phaseBtn,
        { borderColor: border },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {/* Invisible sizer — uses the longer label so the container width is
       *  stable across both states. The two visible labels overlay it and
       *  cross-fade in place. */}
      <View>
        <Text style={[styles.phaseBtnLabel, { opacity: 0 }]}>
          {defaultLabel.length >= altLabel.length ? defaultLabel : altLabel}
        </Text>
        <Animated.Text
          style={[
            styles.phaseBtnLabel,
            styles.phaseBtnLabelOverlay,
            { color: fg, opacity: fadeOut },
          ]}
        >
          {defaultLabel}
        </Animated.Text>
        <Animated.Text
          style={[
            styles.phaseBtnLabel,
            styles.phaseBtnLabelOverlay,
            { color: fg, opacity: phase },
          ]}
        >
          {altLabel}
        </Animated.Text>
      </View>
    </Pressable>
  )
}

/**
 * The note on a read-only day card. Collapsed it is NotePreview's two lines;
 * tapping it opens the whole thing. Notes can run long, and a card that opened
 * them by default pushed its own sets off the screen.
 *
 * Defined here rather than reusing the Summary tab's `CollapsibleNote`: that
 * one carries a label because it renders three note kinds side by side. A day
 * card shows one note, so a label would say nothing.
 */
function ExpandableNote({ note }: { note: string }) {
  const { open, toggle, spin } = useExpandToggle()
  const text = note.trim()

  if (!text) return null

  return (
    <Pressable
      onPress={toggle}
      hitSlop={6}
      unstable_pressDelay={0}
      // Dim the text instead of `pressedStyle`. The row runs the full width of
      // the card, so a background wash reads as a bar across the header rather
      // than as feedback on the note.
      style={({ pressed }) => [styles.dayCardNoteRow, pressed && { opacity: 0.55 }]}
    >
      {/* The wrapper takes the row's remaining width. dayCardNote must NOT: it
          is applied per line inside NotePreview's column, where flex:1 makes
          every line stretch instead of stacking. */}
      <View style={styles.dayCardNoteBody}>
        {open ? (
          <Text style={styles.dayCardNote}>{text}</Text>
        ) : (
          <NotePreview note={text} style={styles.dayCardNote} />
        )}
      </View>
      <SpinChevron progress={spin} size={12} />
    </Pressable>
  )
}

/** How long the position-to-position row cross-fade runs. Short on purpose:
 *  it lands on the same frame as the newly logged set's own fade-in, and two
 *  slow fades at once read as the screen hesitating. */
const POSITION_SWAP_MS = 140
/** Row slots the position body always reserves, records or not. */
const POSITION_ROWS = 3
/** Line height of the header's right-hand slot texts. Explicit, because the
 *  slot stacks them with a negative margin of exactly this much. */
const SLOT_LINE_H = 14
const CAL_BTN_W = 26
const POSITION_ROW_H = 22

/** One "top weight for N reps" line: weight, rep count, and the date. */
function TopWeightRow({
  r,
  unit,
  style,
}: {
  r: TopRepRecord
  unit: "kg" | "lb"
  style?: ViewStyle
}) {
  return (
    <View style={[styles.topRow, style]}>
      <Text style={styles.topWeight}>
        {formatWeight(r.weightKg, unit)}
        <Text style={styles.topUnit}> {unit}</Text>
      </Text>
      <Text style={styles.topReps}>
        × {r.reps} {r.reps === 1 ? "rep" : "reps"}
      </Text>
      <Text style={styles.topDate}>{recordDate(r.date)}</Text>
    </View>
  )
}

/**
 * The record rows for one set position. Always exactly POSITION_ROWS slots
 * tall, so the box never changes height and a swap between positions does no
 * layout work at all.
 */
function PositionRows({
  records,
  position,
  unit,
}: {
  records: TopRepRecord[]
  position: number
  unit: "kg" | "lb"
}) {
  if (records.length === 0) {
    return (
      <Text style={[styles.lastTimeEmpty, styles.posEmptyLine]}>
        No record yet for set {position}.
      </Text>
    )
  }
  return (
    <>
      {records.map((r) => (
        <TopWeightRow key={r.reps} r={r} unit={unit} style={styles.posRow} />
      ))}
    </>
  )
}

/**
 * "What to beat" for the tab you log from. Deliberately not the Summary tab's
 * layout — that one is a full day card with a set list and note strips, and it
 * would dwarf the form above it.
 *
 * Two modes, picked by `nextPosition` alone:
 *
 * - **Last time** (`nextPosition === 1`, nothing logged today). The previous
 *   session as a row of chips, then the top weights across every set of the
 *   exercise. This is the whole card as it was before position mode existed.
 * - **Position** (`nextPosition >= 2`). The previous session block leaves, and
 *   the rows become the top weights for the set position about to be logged.
 *   After one set that is set 2, after two sets set 3, and so on.
 *
 * Renders nothing when the exercise has no weight×reps history: a cardio
 * exercise has no top weights, and a first session has no last time.
 */
const LastTimePanel = memo(function LastTimePanel({
  days,
  currentDate,
  unit,
  nextPosition,
  isWeightReps,
  onPressDate,
  onShowMore,
}: {
  days: ExerciseHistoryDay[]
  /** The day being logged. Its own sets are already on screen above. */
  currentDate: string
  unit: "kg" | "lb"
  /** 1-based position the next save would take. 1 means nothing is logged for
   *  this exercise today. Comes from the screen's `sets`, never from `days`:
   *  `days` only moves once the store mutation commits, which is too late to
   *  start an animation on the click frame. */
  nextPosition: number
  /** Set positions only mean something for weight×reps exercises — prs.ts
   *  skips every other kind, so there are no position records to show and the
   *  card stays in last-time mode for its whole life. */
  isWeightReps: boolean
  onPressDate?: (date: string) => void
  /** Opens the Summary tab, which carries the full record table. */
  onShowMore?: () => void
}) {
  // Also skips a future-dated session, which is not a "last time".
  const last = useMemo(() => lastSessionBefore(days, currentDate), [days, currentDate])

  // Both record sets are built from every day EXCEPT the one being logged.
  //
  // In steady state that changes nothing on screen. The last-time layer only
  // shows while the day has no logged set, so today contributes nothing to it.
  // Position mode always shows the position *after* the last one logged, which
  // today has not filled. Today's own sets are on screen in the list above
  // either way.
  //
  // What it removes is drift. Deleting a set fades the row immediately but
  // runs api.deleteSet 180ms later, so for those frames the records still hold
  // a set that is on its way out. When the mutation landed, the layer
  // re-measured shorter and the card's height animation retargeted mid-flight.
  // That is the glitch on delete, and on the add that followed it. Excluding
  // today makes both record sets identical before and after the commit, so the
  // measured height never moves and the animation runs once.
  const priorDays = useMemo(
    () => days.filter((d) => d.date !== currentDate),
    [days, currentDate]
  )
  const top = useMemo(() => topRepRecords(priorDays, POSITION_ROWS), [priorDays])
  // Every position in one pass, so a swap is a map lookup rather than a fresh
  // scan of the whole history.
  const byPosition = useMemo(
    () => topRepRecordsByPosition(priorDays, POSITION_ROWS),
    [priorDays]
  )

  const hasSets = nextPosition >= 2
  const positionMode = isWeightReps && hasSets

  // `null` means nobody has touched the chevron, so the card still follows the
  // session; one tap and the choice is the user's for as long as the screen
  // lives. Position mode defaults open — it is the card's whole job once a set
  // is down. With no earlier session there is nothing to collapse to in last
  // time mode either, so that stays open for its records.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = lastTimeCardOpen({ manual, positionMode, hasSets, hasLast: last != null })

  // Which position the rows currently show, and the one they are fading away
  // from. Both are rendered during a swap, so no state change has to land at a
  // precise moment for the cross-fade to look right.
  const [shownPos, setShownPos] = useState(nextPosition)
  const [prevPos, setPrevPos] = useState<number | null>(null)
  const swap = useRef(new Animated.Value(1)).current
  // The position last handled lives in a ref, not in the dep list. Reading
  // `shownPos` here instead would re-run this effect on the very re-render it
  // causes, and the cleanup would stop the animation it just started — leaving
  // the rows stranded at opacity 0.
  const handledPos = useRef(nextPosition)
  const swapAnim = useRef<Animated.CompositeAnimation | null>(null)
  useEffect(() => {
    const from = handledPos.current
    if (from === nextPosition) return
    handledPos.current = nextPosition
    swapAnim.current?.stop()
    // Crossing into or out of position mode is the mode switch's animation to
    // run, not ours. Two fades over the same pixels read as a stutter.
    if (from <= 1 || nextPosition <= 1) {
      setShownPos(nextPosition)
      setPrevPos(null)
      swap.setValue(1)
      return
    }
    setPrevPos(from)
    setShownPos(nextPosition)
    swap.setValue(0)
    const a = Animated.timing(swap, {
      toValue: 1,
      duration: POSITION_SWAP_MS,
      easing: Easing.out(Easing.quad),
      // Native driver on purpose. This fires on the same frame as the PR
      // recompute, the index rebuild and the list re-render, and a JS-driver
      // animation would be stalled by all three. Because it cannot be, sets 2
      // and up need none of the mutation deferral the first set gets.
      useNativeDriver: true,
    })
    swapAnim.current = a
    a.start(({ finished }) => {
      // Dropping the outgoing copy late is harmless: it is already at opacity
      // 0, so a busy JS thread cannot make this visible.
      if (finished) setPrevPos(null)
    })
  }, [nextPosition, swap])
  useEffect(() => () => swapAnim.current?.stop(), [])

  // `shownPos` is written from an effect, so it lags by one commit. For a
  // cross-fade that is fine: both copies are mounted and the fade begins when
  // the state lands. For the mode switch it is not, because the body's height
  // target is measured off the position layer. A lagging position meant the
  // card began collapsing toward the OLD position's height and retargeted a
  // frame later - one movement, then a second one correcting it. That was
  // invisible while every position reserved three slots and only showed up
  // once the empty state got shorter.
  //
  // So the lag is kept for the one case that needs it, and skipped otherwise.
  const crossFading = shownPos > 1 && nextPosition > 1
  const displayPos = crossFading ? shownPos : nextPosition

  // The rows box is as tall as the rows it holds, one slot per record, with a
  // floor of one slot for the "no record yet" line. Reserving three slots
  // whatever a position held was what left dead space under a position with
  // one record.
  //
  // Height is read off `nextPosition`, NOT `displayPos`. Content can lag by a
  // commit, because during a cross-fade both copies are mounted and the fade
  // only has to start when the state lands. Height cannot: the card has to
  // begin moving on the frame the set is logged, or it starts toward the old
  // height and corrects itself a frame later. That second movement is what
  // made the swap into an empty position look wrong - `displayPos` fixed it
  // for the mode switch and left it in place for every position-to-position
  // swap, which is exactly how an empty position is reached.
  const positionLayerH =
    Math.max(
      1,
      Math.min((byPosition.get(nextPosition) ?? []).length, POSITION_ROWS)
    ) * POSITION_ROW_H

  // Opacity only, so both of these stay on the native driver.
  const modeAnim = useRef(new Animated.Value(positionMode ? 1 : 0)).current
  const openAnim = useRef(new Animated.Value(open ? 1 : 0)).current
  // modeLayout is modeAnim's JS-driver twin, for the one layout prop the
  // header animates (the calendar button's width). A single Animated.Value
  // cannot serve both drivers, so it is two values on one clock.
  const modeLayout = useRef(new Animated.Value(positionMode ? 1 : 0)).current
  // Two values on one clock rather than an Animated.parallel: same duration and
  // easing, started in the same commit, and nothing reads their joint
  // completion. One of them cannot leave JS (see modeLayout above).
  useToggleTiming(modeAnim, positionMode, { inMs: LAST_TIME_COLLAPSE_MS })
  useToggleTiming(modeLayout, positionMode, {
    inMs: LAST_TIME_COLLAPSE_MS,
    native: false,
  })
  useToggleTiming(openAnim, open, { inMs: LAST_TIME_COLLAPSE_MS })

  const lastTimeOpacity = useMemo(
    () => Animated.multiply(Animated.subtract(1, modeAnim), openAnim),
    [modeAnim, openAnim]
  )
  const collapsedOpacity = useMemo(
    () =>
      Animated.multiply(
        Animated.subtract(1, modeAnim),
        Animated.subtract(1, openAnim)
      ),
    [modeAnim, openAnim]
  )
  const positionOpacity = useMemo(
    () => Animated.multiply(modeAnim, openAnim),
    [modeAnim, openAnim]
  )
  // Inverses for the header, which cross-fades its own pieces on the same
  // values.
  const modeOff = useMemo(() => Animated.subtract(1, modeAnim), [modeAnim])
  const swapOff = useMemo(() => Animated.subtract(1, swap), [swap])

  // The body is three stacked layers inside one box whose height eases toward
  // the active layer's measured height — the same trick as the form/selection
  // bar swap above, generalised from two layers to three. LayoutAnimation was
  // doing this job badly: on the save path the only safe config is update-only,
  // so the chips and records vanished on the spot and just the empty box slid,
  // which read as no animation at all.
  //
  // Nothing here is a hardcoded height. The position layer measures constant on
  // its own, because its rows box reserves POSITION_ROWS slots whether or not
  // there are records to fill them.
  type LayerKey = "lastTime" | "position" | "collapsed"
  const [heights, setHeights] = useState<Record<LayerKey, number | null>>({
    lastTime: null,
    position: null,
    collapsed: null,
  })
  const measure = useCallback(
    (key: LayerKey) => (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height)
      setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }))
    },
    []
  )

  // Position mode collapsed has no stand-in line to show, so it closes to the
  // header alone.
  const activeKey: LayerKey | null = open
    ? positionMode
      ? "position"
      : "lastTime"
    : positionMode
      ? null
      : "collapsed"
  // The position layer's height is computed, not measured: the layer holds the
  // rows box and nothing else, and that box's height follows directly from the
  // record count above. A measured height arrives from `onLayout`, a commit
  // behind the render that changed the content, which is the same one-frame
  // lag described there. The other two layers hold variable content - chips, a
  // note line, a rule - so they are still measured.
  const target =
    activeKey == null
      ? 0
      : activeKey === "position"
        ? positionLayerH
        : heights[activeKey]

  const heightAnim = useRef(new Animated.Value(0)).current
  const [primed, setPrimed] = useState(false)
  const lastTarget = useRef<number | null>(null)
  useEffect(() => {
    if (target == null) return
    const from = lastTarget.current
    lastTarget.current = target
    // First usable measurement: jump straight to it. Animating from 0 here
    // would play a grow-in every time the screen mounts.
    if (!primed) {
      heightAnim.setValue(target)
      setPrimed(true)
      return
    }
    if (from === target) return
    const a = Animated.timing(heightAnim, {
      toValue: target,
      // One duration in both directions, and the same one the opacity
      // animations use. Growing used to take 240ms while the layers faded over
      // 190ms, so the chips finished appearing 50ms before the card finished
      // opening and spent that time cramped against the clip. It is also the
      // value the save path defers its mutation by, so the first set's switch
      // still gets a clear thread.
      duration: LAST_TIME_COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // height is a layout prop
    })
    a.start()
    return () => a.stop()
  }, [target, primed, heightAnim])

  const toggle = useCallback(() => setManual((v) => !(v ?? open)), [open])

  // The last-time guard is unchanged. Position mode adds nothing to it: a card
  // that survives to position mode always had records to get there.
  if (!last && top.length === 0) return null

  const collapsedLine = last ? lastSessionSummary(last.sets, unit) : ""

  // Only the active layer sits in flow, and only while its height is unknown.
  // That is what gives the box its height before the first measurement lands,
  // so a screen that opens straight into position mode does not flash the
  // last-time layer's height first. It is also the fallback if a layer somehow
  // never reports a height: the card still shows its content at natural size
  // rather than collapsing to nothing.
  const inFlow = (key: LayerKey) =>
    activeKey === key && (!primed || target == null)

  return (
    <View style={styles.lastTimeCard}>
      <View style={styles.lastTimeHead}>
        {/* A sibling of the calendar button rather than its parent: nesting
            Pressables here is what made the picker card need a double tap. */}
        <Pressable
          onPress={toggle}
          hitSlop={6}
          unstable_pressDelay={0}
          style={({ pressed }) => [
            styles.lastTimeToggle,
            pressed && { opacity: 0.55 },
          ]}
        >
          {/* Both mode labels are always mounted and cross-fade on modeAnim,
              the same native-driver value the body layers use, so the header
              changes on the body's clock instead of cutting a frame ahead of
              it. The longer one sits in flow and sets the width; the other is
              stacked on top of it. */}
          <View>
            <Animated.Text
              style={[styles.lastTimeLabel, { opacity: modeAnim }]}
            >
              Top weights
            </Animated.Text>
            <Animated.Text
              style={[
                styles.lastTimeLabel,
                styles.lastTimeStackLeft,
                { opacity: modeOff },
              ]}
            >
              Last time
            </Animated.Text>
          </View>
          {/* The position number and the "ago" label share one slot: both say
              which session the rows below belong to, and only one mode has an
              answer at a time. Same treatment: both mounted, cross-faded on
              modeAnim. Within position mode the number cross-fades between
              two copies on `swap`, exactly like the rows below it, rather
              than cutting to nothing and fading back in. */}
          {/* Every piece here is in flow, and the later ones are pulled up by
              one line height so they overlap the first. That is deliberate:
              an absolutely positioned Text is clipped to its parent's width,
              and the slot's width was being set by "Set N" alone - so a
              "4 days ago" label pinned to its right edge came out as "4…".
              In flow, the slot is as wide as its widest child, and all of
              them are right-aligned within it. */}
          <View style={styles.lastTimeSlot}>
            {last && (
              <Animated.Text
                style={[styles.lastTimeAgo, { opacity: modeOff }]}
                numberOfLines={1}
              >
                {agoLabel(last.date)}
              </Animated.Text>
            )}
            <Animated.View
              style={[
                { opacity: modeAnim, alignItems: "flex-end" },
                last && styles.lastTimeOverlap,
              ]}
            >
              <Animated.Text
                style={[styles.lastTimePos, { opacity: swap }]}
                numberOfLines={1}
              >
                Set {displayPos}
              </Animated.Text>
              {prevPos != null && (
                <Animated.Text
                  style={[
                    styles.lastTimePos,
                    styles.lastTimeOverlap,
                    { opacity: swapOff },
                  ]}
                  numberOfLines={1}
                >
                  Set {prevPos}
                </Animated.Text>
              )}
            </Animated.View>
          </View>
          <SpinChevron progress={openAnim} size={13} />
        </Pressable>
        {/* The calendar shortcut opens the previous session, so it goes with
            the chips when position mode takes over. It fades rather than
            unmounting, and keeps its width while faded, so the chevron beside
            it does not jump sideways on the switch. */}
        {last && onPressDate && (
          <Animated.View
            // Every animated prop on this one view is JS-driven, opacity
            // included. Width and margin are layout props and cannot ride the
            // native driver; and a view cannot mix drivers - once a native
            // animation touches it, React Native moves all of its animated
            // props native and the JS-driven one throws at .start(). So the
            // opacity here comes from modeLayout too, not modeAnim. It is
            // the same value on the same clock, only the driver differs.
            style={{
              opacity: modeLayout.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
              overflow: "hidden",
              width: modeLayout.interpolate({
                inputRange: [0, 1],
                outputRange: [CAL_BTN_W, 0],
              }),
              marginLeft: modeLayout.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -theme.spacing[2]],
              }),
            }}
            pointerEvents={positionMode ? "none" : "auto"}
          >
            <CalendarButton
              onPress={() => onPressDate(last.date)}
              size={15}
              style={styles.lastTimeCalBtn}
            />
          </Animated.View>
        )}
      </View>

      <Animated.View
        style={[
          { overflow: "hidden" },
          primed && target != null && { height: heightAnim },
        ]}
      >
        {/* Collapsed layer. The last-time stand-in: the same sets on one
            truncated line. */}
        <Animated.View
          onLayout={measure("collapsed")}
          pointerEvents="none"
          style={[
            !inFlow("collapsed") && styles.lastTimeLayer,
            { opacity: collapsedOpacity },
          ]}
        >
          {!!collapsedLine && (
            <Text style={styles.lastTimeSummary} numberOfLines={1}>
              {collapsedLine}
            </Text>
          )}
        </Animated.View>

        {/* Position layer. Stays mounted in last-time mode so its height is
            already measured when the first set switches modes. */}
        <Animated.View
          pointerEvents={positionMode && open ? "auto" : "none"}
          style={[
            !inFlow("position") && styles.lastTimeLayer,
            { opacity: positionOpacity, gap: theme.spacing[2] },
          ]}
        >
          <View style={{ height: positionLayerH }}>
            {prevPos != null && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.posRowsLayer,
                  { opacity: Animated.subtract(1, swap) },
                ]}
              >
                <PositionRows
                  records={byPosition.get(prevPos) ?? []}
                  position={prevPos}
                  unit={unit}
                />
              </Animated.View>
            )}
            <Animated.View style={[styles.posRowsLayer, { opacity: swap }]}>
              <PositionRows
                records={byPosition.get(displayPos) ?? []}
                position={displayPos}
                unit={unit}
              />
            </Animated.View>
          </View>
        </Animated.View>

        {/* Last-time layer. */}
        <Animated.View
          onLayout={measure("lastTime")}
          pointerEvents={!positionMode && open ? "auto" : "none"}
          style={[
            !inFlow("lastTime") && styles.lastTimeLayer,
            { opacity: lastTimeOpacity, gap: theme.spacing[2] },
          ]}
        >
          {last ? (
            <View style={styles.lastTimeChips}>
              {last.sets.map((s) => (
                <View key={s.id} style={styles.lastTimeChip}>
                  <Text style={styles.lastTimeChipText}>
                    {formatWeight(s.weight, unit)}
                    <Text style={styles.lastTimeChipX}> × </Text>
                    {s.reps}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.lastTimeEmpty}>
              No earlier session for this exercise.
            </Text>
          )}

          {top.length > 0 && (
            <>
              <View style={styles.lastTimeRule} />
              <Text style={styles.lastTimeLabel}>Top weights</Text>
              {top.map((r) => (
                <TopWeightRow key={r.reps} r={r} unit={unit} />
              ))}
            </>
          )}
        </Animated.View>
      </Animated.View>

      {/* One "Show more", outside the animated body and below it.
       *
       *  It used to live inside each layer, which meant two of them existed at
       *  once, at different heights, cross-fading during the mode switch. Both
       *  carry a hairline top border, so the eye read the line as jumping up
       *  the card rather than moving. One element in flow under the body has
       *  nothing to cross-fade against: it simply rides up as the body's
       *  animated height shrinks, on the same clock.
       *
       *  It now stays visible while the card is collapsed. That is the
       *  trade: hiding it would need either a mount/unmount mid-animation
       *  (another jump) or a second height animation of its own. */}
      {onShowMore && (
        <Pressable
          onPress={onShowMore}
          hitSlop={8}
          unstable_pressDelay={0}
          style={({ pressed }) => [
            styles.lastTimeMore,
            pressed && { opacity: 0.55 },
          ]}
        >
          <Text style={styles.lastTimeMoreText}>Show more</Text>
          <Ionicons
            name="chevron-forward"
            size={13}
            color={theme.colors.muted}
          />
        </Pressable>
      )}
    </View>
  )
})

const HistoryDayCard = memo(function HistoryDayCard({
  day,
  onPressDate,
}: {
  day: ExerciseHistoryDay
  onPressDate?: (date: string) => void
}) {
  return (
    <View style={styles.dayCard}>
      <View style={styles.dayCardHeader}>
        <View style={styles.dayCardTitleCol}>
          <Text style={styles.dayDate}>{niceDate(day.date)}</Text>
          <ExpandableNote note={day.note} />
        </View>
        {onPressDate && (
          <CalendarButton
            onPress={() => onPressDate(day.date)}
            size={16}
            style={styles.dayCardCalBtn}
          />
        )}
      </View>
      <SharedSetList sets={day.sets} showNotes />
    </View>
  )
})

const HistoryListHeader = () => (
  <Text style={[styles.section, { marginBottom: theme.spacing[3] }]}>
    Past sessions
  </Text>
)

const HistoryItemSeparator = () => (
  <View style={{ height: theme.spacing[3] }} />
)

/**
 * Used by ExerciseDetailScreen, where this component sits *inside* a parent
 * ScrollView and virtualization isn't practical. SetLoggerScreen renders
 * `PastHistoryList` directly instead so the FlatList can be the scroll host.
 */
export function PastHistory({
  days,
  currentDate,
  onPressDate,
}: {
  days: ExerciseHistoryDay[]
  currentDate: string
  onPressDate?: (date: string) => void
}) {
  const past = useMemo(() => pastDays(days, currentDate), [days, currentDate])
  if (past.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No past workouts for this exercise yet.</Text>
      </View>
    )
  }
  return (
    <View style={{ gap: theme.spacing[3] }}>
      <Text style={styles.section}>Past sessions</Text>
      {past.map((day) => (
        <HistoryDayCard key={day.date} day={day} onPressDate={onPressDate} />
      ))}
    </View>
  )
}

/**
 * Virtualized variant of PastHistory. Acts as its own scroll host (FlatList)
 * so off-screen day cards stay unmounted — keeps scrolling responsive on
 * exercises with hundreds of past sessions.
 */
export function PastHistoryList({
  days,
  currentDate,
  onPressDate,
  contentContainerStyle,
  style,
}: {
  days: ExerciseHistoryDay[]
  currentDate: string
  onPressDate?: (date: string) => void
  contentContainerStyle?: any
  style?: any
}) {
  const past = useMemo(() => pastDays(days, currentDate), [days, currentDate])
  const renderItem = useCallback(
    ({ item }: { item: ExerciseHistoryDay }) => (
      <HistoryDayCard day={item} onPressDate={onPressDate} />
    ),
    [onPressDate]
  )
  const keyExtractor = useCallback(
    (item: ExerciseHistoryDay) => item.date,
    []
  )
  if (past.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No past workouts for this exercise yet.</Text>
      </View>
    )
  }
  return (
    <FlatList
      style={style}
      contentContainerStyle={contentContainerStyle}
      data={past}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={HistoryListHeader}
      ItemSeparatorComponent={HistoryItemSeparator}
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      windowSize={7}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  )
}

// dayValueKg and the chart's derivations live in @lift/core/exerciseStats so
// the web graph plots the same values.

export function GraphPanel({ days, unit }: { days: ExerciseHistoryDay[]; unit: "kg" | "lb" }) {
  const [metric, setMetric] = useState<Metric>("per_set")
  const [setIndex, setSetIndex] = useState<number>(1)
  const points = useMemo(
    () => chartPoints(days, metric, setIndex, unit),
    [days, metric, setIndex, unit]
  )

  const opt = METRIC_OPTIONS.find((m) => m.value === metric)!
  const headerLabel = graphHeaderLabel(metric, setIndex)

  if (points.length === 0) {
    const emptyMessage = graphEmptyMessage(metric, setIndex)
    return (
      <View style={styles.graphWrap}>
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartEyebrow}>{headerLabel}</Text>
              <View style={styles.chartValueRow}>
                <Text style={styles.chartValue}>-</Text>
                <Text style={styles.chartUnit}>{unit}</Text>
              </View>
            </View>
            <Text style={styles.chartCount}>0 workouts</Text>
          </View>

          <View style={styles.chartLegendRow}>
            <View style={styles.chartLegendItem}>
              <View style={[styles.statDot, { backgroundColor: theme.colors.primary }]} />
              <Text style={styles.chartLegendText}>{opt.label}</Text>
            </View>
            <Text style={styles.chartLegendText}>-</Text>
          </View>

          <View style={styles.chartEmpty}>
            <Text style={styles.emptyText}>{emptyMessage}</Text>
          </View>

          <View style={styles.chartStats}>
            <Stat label="Peak" value="-" unit={unit} accent="green" />
            <Stat label="Average" value="-" unit={unit} accent="muted" />
            <Stat label="Latest" value="-" unit={unit} accent="primary" />
          </View>
        </View>

        <View style={styles.metricPanel}>
          <Text style={styles.metricPanelLabel}>Metric</Text>
          <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          {metric === "per_set" && (
            <Segmented
              options={SET_INDEX_OPTIONS}
              value={setIndex}
              onChange={setSetIndex}
              style={{ marginTop: 8 }}
            />
          )}
        </View>
      </View>
    )
  }

  const values = points.map((p) => p.value)
  const latest = points[points.length - 1]
  const first = points[0]
  const peak = Math.max(...values)
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  const delta = latest.value - first.value

  return (
    <View style={styles.graphWrap}>
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartEyebrow}>{headerLabel}</Text>
            <View style={styles.chartValueRow}>
              <Text style={styles.chartValue}>{fmtMetric(latest.value)}</Text>
              <Text style={styles.chartUnit}>{unit}</Text>
              {points.length > 1 && (
                <Text
                  style={[
                    styles.chartDelta,
                    delta > 0
                      ? styles.chartDeltaUp
                      : delta < 0
                        ? styles.chartDeltaDown
                        : null,
                  ]}
                >
                  {delta > 0 ? "+" : ""}
                  {fmtMetric(delta)} since first
                </Text>
              )}
            </View>
          </View>
          <Text style={styles.chartCount}>
          {points.length} workout{points.length === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.chartLegendRow}>
          <View style={styles.chartLegendItem}>
            <View style={[styles.statDot, { backgroundColor: theme.colors.primary }]} />
            <Text style={styles.chartLegendText}>{opt.label}</Text>
          </View>
          <Text style={styles.chartLegendText}>{niceDate(latest.date)}</Text>
        </View>

        <SvgLineChart
          key={`${metric}-${setIndex}`}
          points={points}
          unit={unit}
          metric={metric}
          peak={peak}
        />

        <View style={styles.chartStats}>
          <Stat label="Peak" value={fmtMetric(peak)} unit={unit} accent="green" />
          <Stat label="Average" value={fmtMetric(avg)} unit={unit} accent="muted" />
          <Stat label="Latest" value={fmtMetric(latest.value)} unit={unit} accent="primary" />
        </View>
      </View>

      <View style={styles.metricPanel}>
        <Text style={styles.metricPanelLabel}>Metric</Text>
        <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        {metric === "per_set" && (
          <Segmented
            options={SET_INDEX_OPTIONS}
            value={setIndex}
            onChange={setSetIndex}
            style={{ marginTop: 8 }}
          />
        )}
      </View>
    </View>
  )
}

function SvgLineChart({
  points,
  unit,
  metric,
  peak,
}: {
  points: ChartPoint[]
  unit: "kg" | "lb"
  metric: Metric
  peak: number
}) {
  const POINT_SPACING = 58
  const INITIAL = 18
  const END = 18
  const Y_AXIS_W = 42
  const CANVAS_H = 220
  const TOP_PAD = 12
  const BOT_PAD = 24
  const DRAW_H = CANVAS_H - TOP_PAD - BOT_PAD

  const screenWidth = Dimensions.get("window").width
  const visibleW = screenWidth - theme.spacing[4] * 4 - Y_AXIS_W
  const naturalW = INITIAL + Math.max(0, points.length - 1) * POINT_SPACING + END
  const contentW = Math.max(visibleW, naturalW)

  // Round step, floored yMin, and the ticks: @lift/core/exerciseStats.
  const { yMin, yMax, ticks: yTickValues } = yAxisScale(points.map((p) => p.value))

  const xFor = (i: number) => {
    if (points.length === 1) return contentW / 2
    return INITIAL + (i * (contentW - INITIAL - END)) / (points.length - 1)
  }
  const yFor = (v: number) =>
    TOP_PAD + (1 - (v - yMin) / (yMax - yMin)) * DRAW_H

  let linePath = ""
  let areaPath = ""
  points.forEach((p, i) => {
    const x = xFor(i)
    const y = yFor(p.value)
    linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
    if (i === 0) areaPath += `M ${x} ${TOP_PAD + DRAW_H} L ${x} ${y}`
    else areaPath += ` L ${x} ${y}`
    if (i === points.length - 1) areaPath += ` L ${x} ${TOP_PAD + DRAW_H} Z`
  })

  const labelIndices = xLabelIndices(points.length)
  const [activeIdx, setActiveIdx] = useState<number | null>(
    points.length > 0 ? points.length - 1 : null
  )
  const active = activeIdx != null ? points[activeIdx] : null
  const initialScrollX = Math.max(0, contentW - visibleW)
  const scrollRef = useRef<ScrollView>(null)
  const userDraggingRef = useRef(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false })
    })
    return () => cancelAnimationFrame(t)
  }, [])

  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: Y_AXIS_W, height: CANVAS_H }}>
        <Svg width={Y_AXIS_W} height={CANVAS_H}>
          {yTickValues.map((v, i) => (
            <SvgText
              key={i}
              x={Y_AXIS_W - 6}
              y={yFor(v) + 3}
              fontSize={10}
              fontWeight="600"
              textAnchor="end"
              fill={theme.colors.muted}
            >
              {fmtMetric(v)}
            </SvgText>
          ))}
        </Svg>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ width: visibleW }}
        contentOffset={{ x: initialScrollX, y: 0 }}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          userDraggingRef.current = true
        }}
        onMomentumScrollEnd={() => {
          userDraggingRef.current = false
        }}
        onScrollEndDrag={() => {
          // If no momentum follows, ensure flag clears after a tick.
          setTimeout(() => {
            userDraggingRef.current = false
          }, 50)
        }}
        onScroll={(e) => {
          if (!userDraggingRef.current) return
          const offsetX = e.nativeEvent.contentOffset.x
          const centerX = offsetX + visibleW / 2
          let closest = 0
          let minDist = Infinity
          for (let i = 0; i < points.length; i++) {
            const d = Math.abs(xFor(i) - centerX)
            if (d < minDist) {
              minDist = d
              closest = i
            }
          }
          if (closest !== activeIdx) setActiveIdx(closest)
        }}
      >
        <Pressable
          onPress={() => setActiveIdx(null)}
          style={{ width: contentW, height: CANVAS_H }}
        >
          <Svg width={contentW} height={CANVAS_H}>
            <G>
              {yTickValues.map((v, i) => (
                <SvgLine
                  key={i}
                  x1={0}
                  x2={contentW}
                  y1={yFor(v)}
                  y2={yFor(v)}
                  stroke={line(0.06)}
                  strokeWidth={1}
                />
              ))}
            </G>
            <SvgPath
              d={areaPath}
              fill={theme.colors.primary}
              fillOpacity={0.18}
            />
            <SvgPath
              d={linePath}
              stroke={theme.colors.primary}
              strokeWidth={2}
              fill="none"
            />
            {points.map((p, i) => {
              const isPeak = p.value === peak
              const isActive = activeIdx === i
              return (
                <G key={i}>
                  <Circle
                    cx={xFor(i)}
                    cy={yFor(p.value)}
                    r={isActive ? 6.5 : isPeak ? 5 : 4}
                    fill={isPeak ? theme.colors.secondary : theme.colors.primary}
                  />
                  <Circle
                    cx={xFor(i)}
                    cy={yFor(p.value)}
                    r={22}
                    fill="transparent"
                    onPress={() => setActiveIdx(i)}
                  />
                </G>
              )
            })}
            {labelIndices.map((i) => (
              <SvgText
                key={`xl-${i}`}
                x={xFor(i)}
                y={CANVAS_H - 6}
                fontSize={10}
                fontWeight="600"
                textAnchor="middle"
                fill={theme.colors.muted}
              >
                {shortDate(points[i].date)}
              </SvgText>
            ))}
            {active && activeIdx != null && (
              <SvgLine
                x1={xFor(activeIdx)}
                x2={xFor(activeIdx)}
                y1={TOP_PAD}
                y2={TOP_PAD + DRAW_H}
                stroke={line(0.22)}
                strokeWidth={1}
              />
            )}
          </Svg>

          {active && activeIdx != null && (
            <View
              pointerEvents="none"
              style={[
                styles.pointerLabel,
                {
                  position: "absolute",
                  left: Math.min(
                    Math.max(xFor(activeIdx) - 55, 4),
                    contentW - 114
                  ),
                  top: Math.max(yFor(active.value) - 56, 4),
                },
              ]}
            >
              <Text style={styles.pointerValue}>
                {fmtMetric(active.value)} {unit}
              </Text>
              {active.reps > 0 && (
                <Text style={styles.pointerDate}>× {active.reps} reps</Text>
              )}
            </View>
          )}
        </Pressable>
      </ScrollView>
    </View>
  )
}

/** A row of equal-width buttons, one of which is active. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  style?: ViewStyle
}) {
  return (
    <View style={[styles.metricSwitcher, style]}>
      {options.map((o) => {
        const active = value === o.value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              styles.metricButton,
              active && styles.metricButtonActive,
              pressed && styles.metricButtonPressed,
            ]}
          >
            <Text style={[styles.metricButtonText, active && styles.metricButtonTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: string
  unit: string
  accent: "primary" | "green" | "muted"
}) {
  const color =
    accent === "green"
      ? theme.colors.secondary
      : accent === "primary"
        ? theme.colors.primary
        : theme.colors.muted
  return (
    <View style={styles.statCard}>
      <View style={styles.statLabelRow}>
        <View style={[styles.statDot, { backgroundColor: color }]} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
    </View>
  )
}

export function SettingsPanel({ navigation }: { navigation: any }) {
  return (
    <View style={{ gap: theme.spacing[3] }}>
      <Text style={styles.section}>Tools</Text>
      <Pressable
        onPress={() => navigation.navigate("OneRepMax")}
        style={({ pressed }) => [styles.settingRow, pressedStyle(pressed)]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.settingLabel}>1 Rep Max Calculator</Text>
          <Text style={styles.settingHint}>
            Plug in any weight × reps to estimate your 1RM and a percentage table.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
      </Pressable>
    </View>
  )
}

// Gold, reused for the "best estimated 1RM" marker on the rep rows.
const GOLD = theme.colors.gold

// RepSort, REP_SORTS and REP_ROWS_COLLAPSED (how the rep-record rows are
// ordered and how many show before "Show all") live in
// @lift/core/exerciseStats.

/**
 * The "Summary" sub-tab (was "Records"): what you did last time for this
 * exercise, the notes attached to that day, and your best set at every rep
 * count you have performed.
 *
 * `excludeDate` is the date being logged right now — the set logger passes its
 * workout date. The last-session card then shows the newest session *before*
 * that date, so it never mirrors the sets you are entering on this screen.
 * ExerciseDetailScreen omits it: there the newest session is the last one.
 */
export const SummaryPanel = memo(function SummaryPanel({
  days,
  unit,
  onPressDate,
  excludeDate,
}: {
  days: ExerciseHistoryDay[]
  unit: "kg" | "lb"
  onPressDate?: (date: string) => void
  excludeDate?: string
}) {
  // getExerciseHistoryQ returns days newest-first, so the first match wins.
  // Never a session that has not happened yet (a workout dated in the future
  // can carry logged sets, and it sorts to the front).
  const lastDay = useMemo(() => pickLastSession(days, excludeDate), [days, excludeDate])

  // The three note kinds that can hang off that date (see CLAUDE.md). They are
  // independent rows in the snapshot; any of them can be empty. `days` is
  // rebuilt on every snapshot change, so keying on it keeps these fresh.
  const lastNotes = useMemo(() => {
    if (!lastDay) return []
    const out: { label: string; text: string }[] = []
    const exercise = lastDay.note.trim()
    if (exercise) out.push({ label: "Exercise", text: exercise })
    const session = (getWorkoutByDateQ(lastDay.date)?.notes ?? "").trim()
    if (session) out.push({ label: "Session", text: session })
    const day = getDayNoteQ(lastDay.date).trim()
    if (day) out.push({ label: "Day", text: day })
    return out
  }, [days, lastDay])

  // Flatten weight×reps sets with their set position (order is 0-based, so the
  // set number shown to the user is order+1) and the date performed.
  const wrSets = useMemo(() => weightRepSets(days), [days])

  // Set numbers actually performed, ascending. Drives the picker; never padded.
  const setNumbers = useMemo(() => setNumbersOf(wrSets), [wrSets])

  // "all" pools every position; otherwise restrict to one set number.
  const [scope, setScope] = useState<"all" | number>("all")
  const [sort, setSort] = useState<RepSort>("weight")
  // The day whose sets the record popup is showing, or null when closed.
  const [recordDay, setRecordDay] = useState<ExerciseHistoryDay | null>(null)

  // The chevron's flip is a transform, which LayoutAnimation cannot animate, so
  // the toggle owns both: the height change and the turn, on one clock.
  const {
    open: showAllRows,
    toggle: toggleShowAllRows,
    reset: resetRows,
    spin: moreSpin,
  } = useExpandToggle()

  const openRecordDay = useCallback(
    (date: string) => {
      setRecordDay(days.find((d) => d.date === date) ?? null)
    },
    [days]
  )

  const scoped = useMemo(
    () => (scope === "all" ? wrSets : wrSets.filter((s) => s.setNum === scope)),
    [wrSets, scope]
  )

  // One row per rep count actually performed in scope: the heaviest weight at
  // that rep count, the day it happened, how many times that rep count was
  // used, and the 1RM it estimates to.
  const repRows = useMemo(() => repRecordRows(scoped, sort), [scoped, sort])

  const visibleRows = showAllRows
    ? repRows
    : repRows.slice(0, REP_ROWS_COLLAPSED)

  if (days.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Nothing logged for this exercise yet. Log a few sets to see your last
          session and your records here.
        </Text>
      </View>
    )
  }

  const sortLabel =
    REP_SORTS.find((s) => s.key === sort)?.label ?? REP_SORTS[0].label

  return (
    <View style={{ gap: theme.spacing[3] }}>
      <Text style={styles.section}>Last session</Text>
      {lastDay ? (
        <View style={styles.dayCard}>
          <View style={styles.dayCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dayDate}>{niceDate(lastDay.date)}</Text>
              <Text style={styles.summaryAgo}>{agoLabel(lastDay.date)}</Text>
            </View>
            {onPressDate && (
              <CalendarButton
                onPress={() => onPressDate(lastDay.date)}
                size={16}
                style={styles.dayCardCalBtn}
              />
            )}
          </View>
          {lastNotes.length > 0 && (
            <View style={styles.summaryNotes}>
              {lastNotes.map((n) => (
                <CollapsibleNote key={n.label} label={n.label} text={n.text} />
              ))}
            </View>
          )}
          <SharedSetList sets={lastDay.sets} showNotes />
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No earlier session for this exercise.
          </Text>
        </View>
      )}

      {repRows.length > 0 && (
        <>
          <Text style={[styles.section, { marginTop: theme.spacing[2] }]}>
            Rep records
          </Text>

          <View style={styles.repPrPickerRow}>
            <PickerTrigger
              icon="layers-outline"
              label={scope === "all" ? "All sets" : `Set ${scope}`}
              title="Show set"
              actions={[
                {
                  id: "all",
                  title: "All sets",
                  subtitle: `${wrSets.length} ${wrSets.length === 1 ? "set" : "sets"}`,
                  selected: scope === "all",
                },
                ...setNumbers.map((n) => {
                  const count = wrSets.filter((s) => s.setNum === n).length
                  return {
                    id: String(n),
                    title: `Set ${n}`,
                    subtitle: `${count} ${count === 1 ? "time" : "times"}`,
                    selected: scope === n,
                  }
                }),
              ]}
              onSelect={(id) => {
                setScope(id === "all" ? "all" : Number(id))
                resetRows()
              }}
            />
            <PickerTrigger
              icon="swap-vertical-outline"
              label={sortLabel}
              title="Sort by"
              actions={REP_SORTS.map((o) => ({
                id: o.key,
                title: o.label,
                subtitle: o.hint,
                selected: sort === o.key,
              }))}
              onSelect={(id) => {
                setSort(id as RepSort)
                resetRows()
              }}
            />
          </View>

          <View style={styles.repPrTable}>
            {visibleRows.map((row, i) => (
              <Pressable
                key={row.reps}
                // Fire immediately rather than waiting out Pressable's default
                // press-in delay inside the ScrollView — same reason as the
                // day card's calendar button.
                unstable_pressDelay={0}
                onPress={() => openRecordDay(row.date)}
                style={({ pressed }) => [
                  styles.repPrRow,
                  i < visibleRows.length - 1 && styles.repPrRowDivider,
                  row.isTopOneRm && styles.repPrRowTop,
                  pressedStyle(pressed),
                ]}
              >
                <View style={styles.repPrTopLine}>
                  <Text style={styles.repPrWeight}>
                    {formatWeight(row.weightKg, unit)}
                    <Text style={styles.repPrUnit}> {unit}</Text>
                  </Text>
                  <Text style={styles.repPrReps}>
                    × {row.reps} {row.reps === 1 ? "rep" : "reps"}
                  </Text>
                  {row.isTopOneRm && (
                    <View style={styles.repPrBestChip}>
                      <Text style={styles.repPrBestChipText}>Best</Text>
                    </View>
                  )}
                  <Text style={styles.repPrDate}>{recordDate(row.date)}</Text>
                </View>
                <View style={styles.repPrBarTrack}>
                  <View
                    style={[
                      styles.repPrBarFill,
                      {
                        width: `${Math.max(2, row.share * 100)}%`,
                        // Shorter bars also sit back, so the ranking reads
                        // even where two rows are close in length.
                        opacity: 0.45 + row.share * 0.55,
                      },
                      row.isTopOneRm && { backgroundColor: GOLD },
                    ]}
                  />
                </View>
              </Pressable>
            ))}

            {repRows.length > REP_ROWS_COLLAPSED && (
              <Pressable
                onPress={toggleShowAllRows}
                style={({ pressed }) => [
                  styles.repPrMoreRow,
                  pressedStyle(pressed),
                ]}
              >
                <Text style={styles.repPrMoreText}>
                  {showAllRows
                    ? `Show top ${REP_ROWS_COLLAPSED}`
                    : `Show all ${repRows.length} rep counts`}
                </Text>
                <SpinChevron progress={moreSpin} color={theme.colors.primary} />
              </Pressable>
            )}
          </View>

          <RecordDayPopup
            day={recordDay}
            onClose={() => setRecordDay(null)}
            onPressDate={onPressDate}
          />
        </>
      )}
    </View>
  )
})

/**
 * What a record row opens: the date it was set, and every set logged for this
 * exercise that day. Tap the backdrop to dismiss, or the calendar button to
 * open that day — same as the last-session card.
 *
 * `day` doubles as the visibility flag. The last non-null value is held in
 * `shown` so the card still has content to render while it fades out.
 */
function RecordDayPopup({
  day,
  onClose,
  onPressDate,
}: {
  day: ExerciseHistoryDay | null
  onClose: () => void
  onPressDate?: (date: string) => void
}) {
  const { mounted, opacity, hide } = usePresence(day != null, {
    inMs: PICKER_FADE_MS,
  })
  // The last non-null day, held so the card still has content to render while
  // it fades out.
  const [shown, setShown] = useState<ExerciseHistoryDay | null>(day)
  useEffect(() => {
    if (day) setShown(day)
  }, [day])

  // Leaving for the calendar skips the fade: a native Modal sits above the
  // whole app, so fading it out over the incoming screen would put 150ms of
  // dimmed backdrop on top of the push. Drop it this commit, navigate on the
  // next frame.
  const goToDate = useCallback(() => {
    if (!shown || !onPressDate) return
    const date = shown.date
    hide()
    onClose()
    requestAnimationFrame(() => onPressDate(date))
  }, [shown, onPressDate, onClose, hide])

  if (!mounted || !shown) return null

  return (
    // Hosted in a Modal so it escapes the Summary tab's ScrollView, centred
    // because it is read-only and has no input for a keyboard to cover. The
    // card does not claim touches: the set list inside is plain Views, so a
    // responder here would block its scroll gesture on a day with many sets.
    <OverlayCard
      opacity={opacity}
      visible={day != null}
      onBackdropPress={onClose}
      align="center"
      hostInModal
    >
      <View style={styles.recordDayHead}>
        <View style={styles.pickerTitleCol}>
          <Text style={overlayCardStyles.title}>{niceDate(shown.date)}</Text>
          <ExpandableNote note={shown.note} />
        </View>
        {onPressDate && (
          <CalendarButton
            onPress={goToDate}
            size={18}
            style={styles.dayCardCalBtn}
          />
        )}
      </View>
      <ScrollView
        style={overlayCardStyles.scroll}
        contentContainerStyle={styles.recordDaySets}
        showsVerticalScrollIndicator
      >
        <SharedSetList sets={shown.sets} showNotes />
      </ScrollView>
    </OverlayCard>
  )
}

/**
 * One note on the last-session card. Collapsed it is a single line — a label,
 * the first line of the note, a chevron. Tapping expands the full text. Notes
 * can run long, and rendering them all open pushed the sets off the screen.
 */
function CollapsibleNote({ label, text }: { label: string; text: string }) {
  const { open, toggle, spin } = useExpandToggle()
  const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? ""

  return (
    <Pressable
      onPress={toggle}
      unstable_pressDelay={0}
      hitSlop={6}
      style={({ pressed }) => [styles.summaryNote, pressedStyle(pressed)]}
    >
      <View style={styles.summaryNoteHead}>
        <Text style={styles.summaryNoteLabel}>{label}</Text>
        <Text
          style={[
            styles.summaryNotePreview,
            // Kept mounted but blank when open, so the label and chevron hold
            // their positions instead of snapping together mid-animation.
            open && { opacity: 0 },
          ]}
          numberOfLines={1}
        >
          {firstLine}
        </Text>
        <SpinChevron progress={spin} />
      </View>
      {open && <Text style={styles.summaryNoteText}>{text}</Text>}
    </Pressable>
  )
}

/**
 * A chip that opens a menu of choices. The chip shows the current one, and the
 * menu marks it with a checkmark via `selected`, so there is no custom active
 * styling to keep in sync.
 */
function PickerTrigger({
  icon,
  label,
  title,
  actions,
  onSelect,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  title: string
  actions: MenuAction[]
  onSelect: (id: string) => void
}) {
  return (
    <MenuButton title={title} actions={actions} onSelect={onSelect}>
      <View style={styles.setPickerTrigger}>
        <Ionicons name={icon} size={13} color={theme.colors.muted} />
        <Text style={styles.setPickerTriggerText} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
      </View>
    </MenuButton>
  )
}

// How long the record-day popup's fade runs. Shorter than the app's standard
// fade: it opens over a scroll view the user is already reading, so it has to
// feel lighter than a form popup. Everything else about that popup - the
// backdrop, the card, the native Modal that escapes SummaryPanel's ScrollView -
// is OverlayCard.
const PICKER_FADE_MS = DUR.fadeFast
/** The small calendar icon that opens a date on the calendar. */
function CalendarButton({
  onPress,
  size,
  style,
}: {
  onPress: () => void
  size: number
  style: ViewStyle
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      unstable_pressDelay={0}
      style={({ pressed }) => [style, pressedStyle(pressed)]}
    >
      <Ionicons name="calendar-outline" size={size} color={theme.colors.muted} />
    </Pressable>
  )
}

function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
  allowDecimal = false,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
  allowDecimal?: boolean
}) {
  // Local text state so intermediate input like "1." doesn't get clobbered
  // by a re-render (which would format value back to "1" and drop the dot).
  // We only resync from `value` when it differs from what the current text
  // parses to — that's the "external change" path (+/-, edit-mode load).
  const [text, setText] = useState<string>(String(value))
  useEffect(() => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(String(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {unit && <Text style={styles.fieldUnit}>{unit}</Text>}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={({ pressed }) => [styles.stepBtn, pressedStyle(pressed)]}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={(t) => {
            const cleaned = cleanNumericText(t, allowDecimal)
            setText(cleaned)
            const n = Number(cleaned)
            if (Number.isFinite(n)) onChange(n)
          }}
          keyboardType={allowDecimal ? "decimal-pad" : "number-pad"}
          selectTextOnFocus
          style={styles.numericInput}
        />
        <Pressable onPress={() => onChange(value + step)} style={({ pressed }) => [styles.stepBtn, pressedStyle(pressed)]}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// Removing the final rows replaces the whole list, including its border and
// timer. Measure both states so the replacement never passes through zero.
function SetListEmptyTransition({
  empty,
  emptyContent,
  onEmptyShown,
  children,
}: {
  empty: boolean
  emptyContent: ReactNode
  onEmptyShown: () => void
  children: ReactNode
}) {
  const progress = useRef(new Animated.Value(empty ? 1 : 0)).current
  const [listHeight, setListHeight] = useState(0)
  const [emptyHeight, setEmptyHeight] = useState(0)
  const onComplete = useRef(onEmptyShown)
  onComplete.current = onEmptyShown
  useEffect(() => {
    if (!empty) {
      progress.setValue(0)
      return
    }
    if (!emptyHeight) return
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    })
    animation.start(({ finished }) => {
      if (finished) onComplete.current()
    })
    return () => animation.stop()
  }, [empty, emptyHeight, progress])

  return (
    <Animated.View style={empty && emptyHeight > 0 ? {
      height: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [listHeight || emptyHeight, emptyHeight],
      }),
      overflow: "hidden",
    } : undefined}>
      <Animated.View
        pointerEvents={empty ? "none" : "auto"}
        accessibilityElementsHidden={empty}
        importantForAccessibility={empty ? "no-hide-descendants" : "auto"}
        onLayout={(event) => {
          if (!empty) setListHeight(event.nativeEvent.layout.height)
        }}
        style={[
          empty ? { position: "absolute", top: 0, left: 0, right: 0 } : undefined,
          { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ]}
      >
        {children}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden={!empty}
        importantForAccessibility={empty ? "auto" : "no-hide-descendants"}
        onLayout={(event) => setEmptyHeight(event.nativeEvent.layout.height)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: progress }}
      >
        {emptyContent}
      </Animated.View>
    </Animated.View>
  )
}

// Three 36px buttons, two 8px gaps, and 8px padding on each side.
const SET_ACTIONS_WIDTH = 140

// Compare only what a row renders. `getWorkoutQ` rebuilds every view object
// on each commit and `recomputePrs` spreads every candidate row, so identity
// never matches across commits; a field compare is what lets an untouched row
// skip its render (and its Swipeable's) when a sibling is added or deleted.
function sameSet(a: WorkoutSet, b: WorkoutSet): boolean {
  return (
    a.id === b.id &&
    a.weight === b.weight &&
    a.reps === b.reps &&
    a.is_pr === b.is_pr &&
    a.was_pr === b.was_pr &&
    a.is_position_pr === b.is_position_pr &&
    a.was_position_pr === b.was_position_pr &&
    a.note === b.note &&
    a.is_planned === b.is_planned &&
    a.created_at === b.created_at
  )
}

// Open-row bookkeeping shared by every row: each row's Swipeable, and the one
// that is currently open so a sibling can close it. Plain mutable refs, no
// state, so a swipe never re-renders the list.
interface SwipeRegistry {
  refs: Map<number, Swipeable | null>
  open: Swipeable | null
}

type SetRowProps = {
  s: WorkoutSet
  index: number
  isLast: boolean
  // The optimistic row: no swipe, no press, until the store has the set.
  pending: boolean
  isSelected: boolean
  selectionMode: boolean
  leaving: boolean
  emptying: boolean
  restLabel: string | null
  unit: "kg" | "lb"
  isCardio: boolean
  showOneRm: boolean
  showPositionPrs: boolean
  registry: SwipeRegistry
  swipeHold: SwipeHold
  onLongPress: (s: WorkoutSet) => void
  onSelectToggle: (id: number) => void
  onPlannedTap: (s: WorkoutSet) => void
  onEdit: (s: WorkoutSet) => void
  onAddNote: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
  onDeleteExited: (id: number) => void
}

function setRowPropsEqual(prev: SetRowProps, next: SetRowProps): boolean {
  for (const key of Object.keys(next) as (keyof SetRowProps)[]) {
    if (key === "s") continue
    if (!Object.is(prev[key], next[key])) return false
  }
  return sameSet(prev.s, next.s)
}

// One set row: the pressable body, and for logged sets the Swipeable with
// its action tray. Memoized so a store commit re-renders only the rows whose
// data or position changed; every callback it receives is identity-stable.
/**
 * A set row's number that marks a change (the set was edited, or a planned
 * set was logged with other numbers): the new value shows at once in the
 * teal accent with a small pop, then settles back to its normal size and
 * color, the same teal the rest ticker uses after a reset. A row appearing
 * for the first time is not marked; it has its own fade-in. Opacity and scale
 * only, on the native driver: the teal is a copy of the text laid over it
 * that fades out. `onChanging` brackets the motion so the row can stop caching
 * itself as a bitmap meanwhile (see SetRow).
 */
function ChangedText({
  text,
  suffix,
  style,
  onChanging,
}: {
  text: string
  suffix?: ReactNode
  style: StyleProp<TextStyle>
  onChanging: (on: boolean) => void
}) {
  const lastText = useRef(text)
  const pop = useRef(new Animated.Value(1)).current
  const tint = useRef(new Animated.Value(0)).current
  const token = useRef(0)
  const active = useRef(false)

  useEffect(() => {
    if (text === lastText.current) return
    lastText.current = text
    const my = ++token.current
    pop.stopAnimation()
    tint.stopAnimation()
    if (!active.current) {
      active.current = true
      onChanging(true)
    }
    pop.setValue(1.14)
    tint.setValue(1)
    Animated.parallel([
      Animated.timing(pop, { toValue: 1, duration: DUR.changePop, easing: EASE.out, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 0, duration: DUR.changeTint, easing: EASE.inOut, useNativeDriver: true }),
    ]).start(() => {
      // A newer change took over; it ends the marking.
      if (my !== token.current || !active.current) return
      active.current = false
      onChanging(false)
    })
  }, [text, pop, tint, onChanging])

  // Unmounting mid-change must not leave the row un-cached.
  useEffect(
    () => () => {
      if (active.current) onChanging(false)
    },
    [onChanging]
  )

  const content = (
    <>
      {text}
      {suffix ? " " : null}
      {suffix}
    </>
  )
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <Text style={style}>{content}</Text>
      <Animated.Text
        style={[style, styles.changedTint, { opacity: tint }]}
        pointerEvents="none"
      >
        {content}
      </Animated.Text>
    </Animated.View>
  )
}

const SetRow = memo(function SetRow({
  s,
  index,
  isLast,
  pending,
  isSelected,
  selectionMode,
  leaving,
  emptying,
  restLabel,
  unit,
  isCardio,
  showOneRm,
  showPositionPrs,
  registry,
  swipeHold,
  onLongPress,
  onSelectToggle,
  onPlannedTap,
  onEdit,
  onAddNote,
  onDelete,
  onDeleteExited,
}: SetRowProps) {
  const onExited = useCallback(() => onDeleteExited(s.id), [onDeleteExited, s.id])
  // While an edited value is marked (ChangedText), the row must not be a
  // cached bitmap: an animated child inside a rasterized layer renders stale.
  // Rasterizing only helps the swipe, and nobody swipes in the moment after
  // Update, so it is switched off for exactly that long.
  const [changing, setChanging] = useState(0)
  const onChanging = useCallback(
    (on: boolean) => setChanging((n) => Math.max(0, n + (on ? 1 : -1))),
    []
  )

  const oneRm = !s.is_planned ? estimateOneRm(s.weight, s.reps) : 0
  const isPr = !!s.is_pr
  const wasPr = !s.is_pr && !!s.was_pr
  const isPosPr = !s.is_pr && !s.was_pr && !!s.is_position_pr
  const wasPosPr =
    !s.is_pr && !s.was_pr && !s.is_position_pr && !!s.was_position_pr

  const body = (
    <HoldPressable
      // undefined (not a no-op) for planned rows: HoldPressable only
      // runs the ramp when onLongPress is set, and a planned row
      // holding to select nothing shouldn't promise an action.
      onLongPress={s.is_planned || pending ? undefined : () => onLongPress(s)}
      // No shrink: this row is flush edge-to-edge in the list, not a
      // standalone card, so scaling it down would pull its background
      // in from the sides and expose the card behind it.
      holdScale={1}
      // Matches the delay this row used before it had a ramp.
      holdDelay={250}
      onPress={() => {
        if (pending) return
        if (s.is_planned) {
          onPlannedTap(s)
          return
        }
        if (selectionMode) onSelectToggle(s.id)
      }}
      // Cache the row's content as a hardware-backed texture so
      // the Swipeable's drag transform is a cheap GPU translate
      // of a pre-rendered bitmap, not a per-frame re-paint of
      // the Pressable + ~6 Text nodes underneath. This is the
      // single biggest fix for "low fps feel" during swipe on
      // Android — without it, every dragX update re-rasterizes
      // the whole row's text layout, which can't keep up at 60fps.
      // collapsable=false ensures Android doesn't optimize this
      // intermediate view away, which would defeat the cache.
      collapsable={false}
      renderToHardwareTextureAndroid={changing === 0}
      shouldRasterizeIOS={changing === 0}
      // Static, not an animated overlay. This row caches itself as a
      // bitmap (see the rasterisation note above), and an animated child
      // inside a cached layer renders stale - the highlight showed the
      // previous state, or vanished, until something forced a re-raster.
      // A style change is part of the layer's content, so it re-rasters
      // correctly.
      style={[
        styles.setRow,
        !isLast && styles.setRowDivider,
        isSelected && styles.setRowSelected,
        s.is_planned && styles.setRowPlanned,
      ]}
    >
      <View style={styles.setRowContent}>
        <View style={{ width: 28, alignItems: "flex-start" }}>
          {!s.is_planned && (isPr || wasPr) ? (
            <PrIcon historical={wasPr} />
          ) : !s.is_planned && showPositionPrs && (isPosPr || wasPosPr) ? (
            <PrIcon variant="position" position={index + 1} historical={wasPosPr} />
          ) : null}
        </View>
        <IndexCol
          display={isSelected ? "✓" : index + 1}
          isPr={isPr}
          restLabel={restLabel}
        />
        <View style={styles.setWeightBox}>
          <ChangedText
            text={isCardio ? String(s.weight ?? "-") : formatWeight(s.weight, unit)}
            suffix={<Text style={styles.setUnit}>{isCardio ? "min" : unit}</Text>}
            style={[styles.setWeightText, s.is_planned && styles.dimText]}
            onChanging={onChanging}
          />
        </View>
        <View style={styles.setRepsBox}>
          <ChangedText
            text={isCardio ? `Lvl ${s.reps ?? "-"}` : String(s.reps ?? "-")}
            style={[styles.setRepsText, s.is_planned && styles.dimText]}
            onChanging={onChanging}
          />
        </View>
        {!isCardio && !s.is_planned && showOneRm && oneRm > 0 ? (
          <Text style={styles.oneRm}>
            {formatWeight(oneRm, unit)} 1RM
          </Text>
        ) : s.is_planned ? (
          <Text style={[styles.oneRm, { fontStyle: "italic" }]}>
            planned
          </Text>
        ) : null}
      </View>

      {!s.is_planned && (
        <NoteReveal note={s.note}>
          <View style={styles.setNoteLine}>
            <Ionicons
              name="document-text-outline"
              size={11}
              color={theme.colors.muted}
            />
            <Text style={styles.setNoteText}>{s.note}</Text>
          </View>
        </NoteReveal>
      )}

    </HoldPressable>
  )

  // Swipe-to-delete only for logged sets (not planned targets, since
  // those have their own Hit/Skip flow above).
  if (s.is_planned)
    return (
      <SetRowFade leaving={leaving} parentHandlesExit={emptying} onExited={onExited}>
        <View>{body}</View>
      </SetRowFade>
    )

  // Imperative close (no state, no re-renders), fired from this row's
  // open-related callbacks. Whichever fires first does the close; later
  // calls are no-ops because `registry.open` is null.
  function closeOtherOpenRow() {
    const current = registry.refs.get(s.id) ?? null
    if (registry.open && registry.open !== current) {
      registry.open.close()
      registry.open = null
    }
  }
  function closeThen(action: () => void) {
    const current = registry.refs.get(s.id) ?? null
    current?.close()
    if (registry.open === current) registry.open = null
    action()
  }

  return (
    <SetRowFade leaving={leaving} parentHandlesExit={emptying} onExited={onExited}>
      <Swipeable
        ref={(ref) => {
          registry.refs.set(s.id, ref)
        }}
        enabled={!selectionMode && !pending}
        // Native-driven animations so the row tracks the finger on the
        // UI thread. With JS driving, fast flicks outrun React's commit
        // cycle and the row stutters / progress never settles at 1
        // (so the action icons never fully fade in). Our renderRight-
        // Actions only animates translateX + opacity — both are
        // natively animatable, so there's no JS/native mixing on the
        // same node.
        useNativeAnimations={true}
        // Require a horizontal gesture before taking it from the scroll
        // view, then settle based on half the actual action-tray width.
        friction={1.4}
        rightThreshold={SET_ACTIONS_WIDTH / 2}
        activeOffsetX={[-12, 12]}
        failOffsetY={[-12, 12]}
        overshootLeft={false}
        overshootRight={false}
        animationOptions={{
          overshootClamping: true,
          bounciness: 0,
          speed: 14,
        }}
        containerStyle={styles.setSwipeContainer}
        childrenContainerStyle={styles.setSwipeChild}
        onSwipeableWillClose={() => {
          dbg(`release (close) id=${s.id}`)
          swipeHold.end(s.id)
          const current = registry.refs.get(s.id) ?? null
          if (registry.open === current) registry.open = null
        }}
        // Claim the open row when its spring starts. A completion
        // callback from an older swipe must not close a newer gesture.
        onSwipeableOpenStartDrag={() => {
          dbg(`drag start id=${s.id}`)
          swipeHold.begin(s.id)
          closeOtherOpenRow()
        }}
        onSwipeableCloseStartDrag={() => swipeHold.begin(s.id)}
        onSwipeableWillOpen={() => {
          dbg(`release (open) id=${s.id}`)
          swipeHold.end(s.id)
          closeOtherOpenRow()
          registry.open = registry.refs.get(s.id) ?? null
        }}
        renderRightActions={(progress, dragX) => {
          // Keep the tray's movement tied to the row's translated
          // position, including the release spring.
          const translateX = dragX.interpolate({
            inputRange: [-SET_ACTIONS_WIDTH, 0],
            outputRange: [0, SET_ACTIONS_WIDTH],
            extrapolate: "clamp",
          })
          // Reveal throughout the drag instead of flashing to full
          // opacity in the first quarter of the swipe.
          const groupOpacity = progress.interpolate({
            inputRange: [0, 0.8, 1],
            outputRange: [0, 1, 1],
            extrapolate: "clamp" as const,
          })
          return (
            <Animated.View
              style={[
                styles.setSwipeActions,
                { transform: [{ translateX }], opacity: groupOpacity },
              ]}
            >
              <Pressable
                onPress={() => closeThen(() => onEdit(s))}
                style={({ pressed }) => [
                  styles.swipeAction,
                  styles.swipeActionEdit,
                  pressed && styles.swipeActionPressed,
                ]}
                hitSlop={4}
              >
                <Ionicons
                  name="pencil"
                  size={18}
                  color={theme.colors.primary}
                />
              </Pressable>
              <Pressable
                onPress={() => closeThen(() => onAddNote(s))}
                style={({ pressed }) => [
                  styles.swipeAction,
                  styles.swipeActionNote,
                  pressed && styles.swipeActionPressed,
                ]}
                hitSlop={4}
              >
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={theme.colors.foreground}
                />
              </Pressable>
              <Pressable
                onPress={() => closeThen(() => onDelete(s))}
                style={({ pressed }) => [
                  styles.swipeAction,
                  styles.swipeActionDelete,
                  pressed && styles.swipeActionPressed,
                ]}
                hitSlop={4}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={theme.colors.destructive}
                />
              </Pressable>
            </Animated.View>
          )
        }}
      >
        {body}
      </Swipeable>
    </SetRowFade>
  )
}, setRowPropsEqual)

// Memoized: the parent re-renders on every keystroke in the form and on every
// store commit. With stable callbacks only `sets`, the selection, and the
// leaving/skip-fade sets can change this component's props.
const SetList = memo(function SetList({
  sets,
  unit,
  isCardio,
  showOneRm,
  showPositionPrs,
  showRestTime,
  showTimeSinceLastSet,
  prevWorkoutLastSetIso,
  exerciseName,
  workoutDate,
  selectedIds,
  pendingAdd,
  leavingIds,
  onDeleteExited,
  swipeHold,
  onLongPress,
  onSelectToggle,
  onPlannedTap,
  onEdit,
  onAddNote,
  onDelete,
}: {
  sets: WorkoutSet[]
  unit: "kg" | "lb"
  isCardio: boolean
  showOneRm: boolean
  showPositionPrs: boolean
  showRestTime: boolean
  showTimeSinceLastSet: boolean
  prevWorkoutLastSetIso: string | null
  exerciseName: string
  workoutDate: string
  selectedIds: number[]
  pendingAdd: {
    weight: number
    reps: number
    key: number
    baseLen: number
    baseIds: Set<number>
    isPr: boolean
    isPosPr: boolean
    position: number
    planned: boolean
  } | null
  leavingIds: Set<number>
  onDeleteExited: (id: number) => void
  swipeHold: SwipeHold
  onLongPress: (s: WorkoutSet) => void
  onSelectToggle: (id: number) => void
  onPlannedTap: (s: WorkoutSet) => void
  onEdit: (s: WorkoutSet) => void
  onAddNote: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const selectionMode = selectedIds.length > 0
  const registry = useRef<SwipeRegistry>({ refs: new Map(), open: null }).current
  // A row that unmounts mid-drag never dispatches its release.
  useEffect(() => () => swipeHold.releaseAll(), [swipeHold])

  const emptying = !pendingAdd && sets.every((set) => leavingIds.has(set.id))
  // A manual reset or stop from the ticker's menu. Not a set: it only moves
  // what the ticker counts from (tickerAnchor), and only on this workout's day.
  const timerMark = useSyncExternalStore(restTimer.subscribeMark, restTimer.getMark)
  const onTimerReset = useCallback(
    () => restTimer.reset(exerciseName, workoutDate),
    [exerciseName, workoutDate]
  )
  const onTimerStop = useCallback(() => restTimer.stop(workoutDate), [workoutDate])
  // With every row leaving, the empty state counts from the other exercise's
  // last set, not from a row on its way out.
  const emptyAnchorMs = tickerAnchor(
    lastSetAnchorMs({ pendingAddMs: null, sets: [], fallbackIso: prevWorkoutLastSetIso }),
    timerMark,
    workoutDate
  )
  const listAnchorMs = tickerAnchor(
    lastSetAnchorMs({
      pendingAddMs: pendingAdd?.key ?? null,
      sets,
      fallbackIso: prevWorkoutLastSetIso,
    }),
    timerMark,
    workoutDate
  )
  const emptyContent = (
    <View>
      <View style={[styles.card, { borderStyle: "dashed", alignItems: "center" }]}>
        <Text style={{ color: theme.colors.muted, fontSize: theme.fontSize.sm }}>
          No sets logged yet. Log your first set above.
        </Text>
      </View>
      {showTimeSinceLastSet && (
        <RestTicker anchorMs={emptyAnchorMs} onReset={onTimerReset} onStop={onTimerStop} />
      )}
    </View>
  )
  // The optimistic row is a real SetRow fed a synthetic set, so it is pixel
  // identical to the row the store will produce: same index column, rest
  // label, divider, and star. Once the real row lands it renders under the
  // placeholder's key, so React updates that instance in place: no swap, no
  // remount, and the fade-in that began on the click frame runs on.
  const landedId = pendingAdd
    ? sets.find((s) => !pendingAdd.baseIds.has(s.id))?.id ?? null
    : null
  const keyOverrides = useRef(new Map<number, string>()).current
  if (pendingAdd && landedId != null) {
    keyOverrides.set(landedId, `pending-${pendingAdd.key}`)
  }
  const placeholder: WorkoutSet | null =
    pendingAdd && landedId == null
      ? {
          id: -1,
          weight: pendingAdd.weight,
          reps: pendingAdd.reps,
          distance_m: null,
          distance_unit_display: "",
          time_seconds: null,
          is_pr: pendingAdd.isPr,
          was_pr: false,
          is_position_pr: pendingAdd.isPosPr,
          was_position_pr: false,
          note: "",
          order: sets.length,
          is_planned: pendingAdd.planned,
          // addSet stamps "now"; the click time is within a frame of it.
          created_at: new Date(pendingAdd.key).toISOString(),
        }
      : null
  const rows = placeholder ? [...sets, placeholder] : sets

  // Per-row rest labels. Anchor on the most recent prior *logged* set:
  // planned rows have synthetic created_at and shouldn't anchor real rest.
  // Set 1's rest comes from the last set of the previous workout.
  const restLabels = setRestLabels(rows, prevWorkoutLastSetIso)

  return (
    <SetListEmptyTransition
      empty={emptying}
      emptyContent={emptyContent}
      onEmptyShown={() => {
        for (const set of sets) {
          if (leavingIds.has(set.id)) onDeleteExited(set.id)
        }
      }}
    >
    {rows.length > 0 && <View style={styles.setListCard}>
      {rows.map((s, i) => {
        const pending = s.id === -1
        const key = pending && pendingAdd
          ? `pending-${pendingAdd.key}`
          : keyOverrides.get(s.id) ?? String(s.id)
        return (
          <SetRow
            key={key}
            s={s}
            index={i}
            isLast={i === rows.length - 1}
            pending={pending}
            isSelected={selectedIds.includes(s.id)}
            selectionMode={selectionMode}
            leaving={leavingIds.has(s.id)}
            emptying={emptying}
            restLabel={showRestTime && !s.is_planned ? restLabels[i] : null}
            unit={unit}
            isCardio={isCardio}
            showOneRm={showOneRm}
            showPositionPrs={showPositionPrs}
            registry={registry}
            swipeHold={swipeHold}
            onLongPress={onLongPress}
            onSelectToggle={onSelectToggle}
            onPlannedTap={onPlannedTap}
            onEdit={onEdit}
            onAddNote={onAddNote}
            onDelete={onDelete}
            onDeleteExited={onDeleteExited}
          />
        )
      })}
      {showTimeSinceLastSet && (
        <RestTicker anchorMs={listAnchorMs} onReset={onTimerReset} onStop={onTimerStop} />
      )}
    </View>}
    </SetListEmptyTransition>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  // Sits in the native header, opposite the back button.
  headerMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // Anchored under the header at the right edge, where the button is.
  // The dim is light: an iOS menu shades what is behind it, it does not
  // black it out.
  exNoteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: 2,
  },
  exNoteBody: { flex: 1 },
  exNoteText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 17,
  },
  fixedTop: { padding: theme.spacing[4], gap: theme.spacing[4] },
  // The form and the bar stack on top of each other inside the animated
  // height wrapper - see the swap itself.
  swapLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  contentScroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Every sub-tab scrolls inside this — the History FlatList included — so
  // any top inset belongs here and nowhere else. There is none: `fixedTop`
  // already ends in 16pt of its own padding, which is the line the workout
  // tab's form card starts on. Adding more here dropped every other tab's
  // first card below it. The panels used to carry their own paddingVertical
  // while the FlatList carried none, which is why they disagreed.
  listScrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[8],
  },
  titleWrap: { gap: 4 },
  // Notes sit inside the card header, under the title — same as the exercise
  // cards on the day and calendar screens. Keep these two in step with
  // `exerciseTitleCol` / `exerciseNote` in DayScreen and DayWorkoutContent.
  // Workout tab "Last time" card. Flatter and tighter than the Summary tab's
  // day card on purpose: it sits under the form you are typing into, so it
  // must read as a footnote, not as a second screen.
  lastTimeCard: {
    marginTop: theme.spacing[4],
    padding: theme.spacing[3],
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: tint(0.02),
    gap: theme.spacing[2],
  },
  // Body layers stack on one another so each measures independently. Only the
  // active layer is left in flow, and only until the first measurement lands;
  // after that the box's animated height drives everything.
  lastTimeLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  // The one fixed height in the card. It reserves POSITION_ROWS slots whether
  // or not a position has that many records, which is what makes every
  // position's body the same height - so a swap from set 2 to set 3 moves no
  // layout, only opacity.
  // Deliberately NOT clipped. During a swap into the empty state the box is
  // already sized for the incoming one-line copy, so the outgoing three rows
  // overflow it. Clipping here cut them to one line on the first frame, before
  // the card had moved at all, which read as the rows being chopped off. Left
  // to overflow, they are instead revealed away by the card body's own
  // animated height, which is clipped and is the thing actually in motion.
  posRowsLayer: { position: "absolute", top: 0, left: 0, right: 0 },
  posRow: { height: POSITION_ROW_H },
  posEmptyLine: { height: POSITION_ROW_H, lineHeight: POSITION_ROW_H },
  lastTimeHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Takes the whole row apart from the calendar button, so the collapsed card
  // is one wide target rather than a chevron to aim at.
  lastTimeToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
  },
  // Collapsed stand-in for the chips: the same sets on one truncated line.
  lastTimeSummary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  lastTimeLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  // Pushed right by auto margin so the calendar button keeps the far edge.
  // Holds the ago label and the set number, stacked; the set number is in
  // flow and sets the slot's width, the ago label is pinned to its right edge
  // and may extend left into the row's slack.
  lastTimeSlot: {
    marginLeft: "auto",
    alignItems: "flex-end",
  },
  lastTimeStackLeft: { position: "absolute", top: 0, left: 0 },
  // Pulls a stacked line up over the one before it. Needs the explicit
  // lineHeight on the two texts below, or the overlap would not be exact.
  lastTimeOverlap: { marginTop: -SLOT_LINE_H },
  lastTimeAgo: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: SLOT_LINE_H,
  },
  // Its own style so bolding the set number does not also bold the "5 days
  // ago" label that shares the slot in last-time mode.
  lastTimePos: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: SLOT_LINE_H,
    fontWeight: "800",
  },
  lastTimeCalBtn: {
    width: CAL_BTN_W,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  // Leads to the Summary tab, so it points forward rather than down like the
  // in-place "Show all" toggle on that tab's own table. Full width and 40pt
  // tall: as a bare line of text it was a hard target to hit.
  lastTimeMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 40,
    marginTop: 2,
    // Pulls the row into the card's bottom padding. The label is centred in
    // its 40pt row, so the row's own lower half plus the card padding left
    // too much space under it. The space above the label is unchanged.
    marginBottom: -10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  lastTimeMoreText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  lastTimeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  lastTimeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  lastTimeChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  lastTimeChipX: { color: theme.colors.muted, fontWeight: "400" },
  lastTimeEmpty: { color: theme.colors.muted, fontSize: theme.fontSize.xs },
  lastTimeRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginTop: 2,
  },
  topRow: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing[2] },
  topWeight: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
  },
  topUnit: { color: theme.colors.muted, fontSize: 10, fontWeight: "600" },
  topReps: { color: theme.colors.muted, fontSize: theme.fontSize.xs, fontWeight: "600" },
  topDate: {
    marginLeft: "auto",
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
  },
  dayCardTitleCol: { flex: 1, gap: 2 },
  dayCardNoteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 1,
  },
  dayCardNoteBody: { flex: 1 },
  dayCardNote: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
  },
  exerciseName: { color: theme.colors.foreground, fontSize: theme.fontSize.xl, fontWeight: "800" },
  exerciseMeta: { color: theme.colors.muted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 1.2 },
  card: {
    backgroundColor: theme.colors.background,
    borderColor: line(0.12),
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[5],
    gap: theme.spacing[4],
  },
  cardEditBorder: {
    position: "absolute",
    // Pull in by 1px so the overlay border sits flush on top of the card's
    // own 1px border instead of doubling its width.
    left: -1,
    right: -1,
    top: -1,
    bottom: -1,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  fieldUnit: { color: theme.colors.muted, fontSize: 10, textTransform: "uppercase" },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: line(0.12),
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: theme.colors.foreground, fontSize: 22, fontWeight: "600" },
  numericInput: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: line(0.12),
    backgroundColor: "transparent",
    color: theme.colors.foreground,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  phaseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  phaseBtnLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
  },
  phaseBtnLabelOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    textAlign: "center",
    textAlignVertical: "center",
  },
  setListCard: {
    backgroundColor: theme.colors.background,
    borderColor: line(0.12),
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    marginTop: theme.spacing[2],
    overflow: "hidden",
  },
  setRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
    minHeight: 48,
    gap: 4,
    justifyContent: "center",
  },
  setRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  setRowDivider: {
    borderBottomColor: line(0.06),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // A plain fill across the row, in the same neutral grey the rest of the app
  // uses for raised surfaces. Reading it from the theme rather than a
  // hardcoded rgba keeps light mode working.
  setRowSelected: {
    backgroundColor: theme.colors.border,
  },
  setRowPlanned: {
    backgroundColor: tint(0.015),
  },
  dimText: {
    color: theme.colors.muted,
    fontStyle: "italic",
  },
  plannedActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plannedActionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  plannedActionHit: {
    backgroundColor: "rgba(62,230,192,0.18)",
    borderColor: "rgba(62,230,192,0.35)",
  },
  plannedActionNotHit: {
    backgroundColor: tint(0.06),
    borderColor: line(0.12),
  },
  plannedActionDelete: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.32)",
  },
  setSwipeContainer: {
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  setSwipeChild: {
    backgroundColor: "transparent",
  },
  setSwipeActions: {
    width: SET_ACTIONS_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    paddingHorizontal: 8,
    gap: 8,
    backgroundColor: "transparent",
  },
  swipeAction: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  swipeActionEdit: {
    backgroundColor: "rgba(0,119,188,0.14)",
    borderColor: "rgba(0,119,188,0.32)",
  },
  swipeActionNote: {
    backgroundColor: tint(0.06),
    borderColor: line(0.12),
  },
  swipeActionDelete: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.32)",
  },
  swipeActionPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.92 }],
  },
  setIndex: { width: 24, color: theme.colors.muted, fontSize: theme.fontSize.base, fontWeight: "700" },
  setIndexCol: { width: 36, alignItems: "flex-start", justifyContent: "center" },
  setRestLabel: { color: theme.colors.muted, fontSize: 9, fontWeight: "500", marginTop: 1 },
  // The row's weight and reps: a box in the old layout slot, holding the
  // text that marks a change (ChangedText).
  setWeightBox: { flex: 1 },
  setWeightText: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "center" },
  setRepsBox: { width: 50 },
  // The teal copy ChangedText lays over a changed number and fades out.
  changedTint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    color: theme.colors.secondary,
  },
  setRepsText: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "right" },
  setUnit: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
  setNoteLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginLeft: 40,
    marginTop: 2,
    paddingRight: 8,
  },
  setNoteText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: 11.5,
    fontStyle: "italic",
    lineHeight: 16,
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  selectionCancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionDeleteBtn: {
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
  selectionDeleteText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  selectionCount: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  // Past-history list (under the today list in History tab).
  section: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  empty: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    padding: theme.spacing[5],
    alignItems: "center",
  },
  emptyText: { color: theme.colors.muted, fontSize: theme.fontSize.sm },
  dayCard: {
    backgroundColor: theme.colors.background,
    borderColor: line(0.18),
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  dayCardHeader: {
    padding: theme.spacing[3],
    backgroundColor: tint(0.10),
    borderBottomColor: line(0.18),
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayDate: { color: theme.colors.foreground, fontWeight: "700", fontSize: theme.fontSize.base },
  dayCardCalBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  oneRm: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  // Graph
  graphWrap: {
    gap: theme.spacing[3],
  },
  metricSwitcher: {
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: tint(0.02),
    padding: 4,
  },
  metricButton: {
    flex: 1,
    alignItems: "center",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  metricButtonActive: {
    backgroundColor: tint(0.10),
  },
  metricButtonPressed: {
    backgroundColor: tint(0.14),
    opacity: 0.92,
  },
  metricButtonText: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  metricButtonTextActive: {
    color: theme.colors.foreground,
  },
  metricPanel: {
    gap: 8,
  },
  metricPanelLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  // Same treatment as the log-set form card: the page background, lifted off
  // it by a brighter border rather than by a lighter fill.
  chartCard: {
    backgroundColor: theme.colors.background,
    borderColor: line(0.12),
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[3],
  },
  chartEyebrow: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  chartValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  chartValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
  },
  chartUnit: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
  },
  chartDelta: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  chartDeltaUp: { color: theme.colors.secondary },
  chartDeltaDown: { color: theme.colors.destructive },
  chartCount: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "right",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  chartLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing[2],
  },
  chartLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chartLegendText: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  pointerLabel: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pointerValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
  },
  pointerDate: {
    color: theme.colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  chartStats: {
    flexDirection: "row",
    gap: 6,
    borderTopColor: line(0.06),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing[3],
    marginTop: theme.spacing[3],
  },
  chartEmpty: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
  },
  statCard: {
    flex: 1,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: line(0.05),
    backgroundColor: tint(0.02),
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statLabel: {
    color: theme.colors.muted,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    marginTop: 3,
  },
  statValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
  },
  statUnit: {
    color: theme.colors.muted,
    fontSize: 9,
    textTransform: "uppercase",
  },
  // Settings tab
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
  },
  settingLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  settingHint: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
  // Summary tab — last session
  summaryAgo: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    marginTop: 1,
  },
  // Notes sit in their own strip between the day header and the set list,
  // padded to line up with SetList's rows and closed off by the same hairline
  // the set rows use.
  summaryNotes: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
    borderBottomColor: line(0.18),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // A full-width card, not a text strip: the collapsed row is a tap target, so
  // it needs real height and padding rather than the 2pt it started with.
  summaryNote: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  summaryNoteHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summaryNoteLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  // Collapsed: one line of the note, truncated. flexShrink lets it give way to
  // the label and the chevron instead of pushing them off the row.
  summaryNotePreview: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  summaryNoteText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    lineHeight: 18,
    marginTop: 3,
  },
  // The scope and sort triggers share a row and split it evenly — two full
  // words ("All sets", "Most reps") don't fit beside the heading on a phone.
  repPrPickerRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  repPrTable: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: line(0.05),
    borderWidth: 1,
    overflow: "hidden",
  },
  repPrRow: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  repPrRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // The row holding the best estimated 1RM in the current scope. Every row
  // carries the transparent edge so marking one never shifts its text.
  repPrRowTop: {
    borderLeftColor: GOLD,
    backgroundColor: "rgba(250,204,21,0.05)",
  },
  repPrBestChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(250,204,21,0.16)",
  },
  repPrBestChipText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  repPrTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Rows lead with the weight now: the list sorts by it, so it is the column
  // the eye should land on first.
  repPrWeight: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  repPrUnit: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  repPrReps: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  // Pushed right by auto margin rather than by flexing the rep count, so the
  // "Best" chip stays next to the set it describes.
  repPrDate: {
    marginLeft: "auto",
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
  },
  repPrBarTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    backgroundColor: theme.colors.border,
    overflow: "hidden",
  },
  repPrBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  repPrMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  repPrMoreText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  setPickerTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  setPickerTriggerText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  // A row inside the record-day card, which is a column. The title column takes
  // the flex here rather than on the card, where flex:1 would stretch the title
  // block and squash the set list under it.
  recordDayHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  pickerTitleCol: { flex: 1, gap: 2 },
  recordDaySets: {
    marginHorizontal: -theme.spacing[4],
  },
})
