import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import Svg, { Circle, G, Line as SvgLine, Path as SvgPath, Text as SvgText } from "react-native-svg"
// Use the legacy (non-Reanimated) Swipeable to avoid pulling in
// react-native-reanimated native init at app boot — which is currently
// throwing "Exception in HostFunction" inside Expo Go on this device.
import { Swipeable } from "react-native-gesture-handler"
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
  useStore,
  weightKey,
} from "@lift/core"
import type {
  ExerciseHistoryDay,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "@lift/core"
import { Button } from "../components/Button"
import { PopupModal } from "../components/PopupModal"
import { HoldPressable } from "../components/HoldPressable"
import { NotePreview } from "../components/NotePreview"
import { PrIcon } from "../components/PrIcon"
import { SetList as SharedSetList } from "../components/SetList"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

type SubTab = "workout" | "history" | "graph" | "summary" | "settings"

// Predict whether a hypothetical (weight, reps) added to `weId` would be the
// current overall PR / position PR for `exerciseId`. Mirrors the dominance
// logic in core's recomputePrsForExercise but runs against the live store at
// click time — so the optimistic placeholder can render the gold star on the
// same frame as the click, instead of waiting for the (rAF-deferred) mutation
// and a second React commit.
function predictPrFlags(
  exerciseId: number,
  weId: number,
  weight: number,
  reps: number
): { isPr: boolean; isPosPr: boolean; position: number } {
  const { indexes } = getState()
  const wes = indexes.workoutExercisesByExercise.get(exerciseId) ?? []
  let isPr = true
  const targetSets = indexes.setsByWorkoutExercise.get(weId) ?? []
  let loggedInTarget = 0
  for (const s of targetSets) {
    if (s.is_planned) continue
    if (s.weight == null || s.reps == null) continue
    loggedInTarget++
  }
  const position = loggedInTarget + 1
  let isPosPr = true
  // Compare on weightKey, matching prs.ts — the saved flag and this preview
  // must agree, and raw kg floats from an import differ from typed ones.
  const key = weightKey(weight)
  for (const we of wes) {
    const arr = (indexes.setsByWorkoutExercise.get(we.id) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id - b.id)
    let posIdx = 0
    for (const s of arr) {
      if (s.is_planned) continue
      if (s.weight == null || s.reps == null) continue
      posIdx++
      const sKey = weightKey(s.weight)
      const dominates =
        (sKey > key && s.reps >= reps) ||
        (sKey === key && s.reps > reps) ||
        (sKey === key && s.reps === reps)
      if (dominates) {
        isPr = false
        if (posIdx === position) isPosPr = false
      }
      if (!isPr && !isPosPr) return { isPr, isPosPr, position }
    }
  }
  return { isPr, isPosPr, position }
}

// Ticking "Xs since last set" / "Xm Ys since last set" label. Hides when
// elapsed > 30 min — at that point the user is presumed not mid-workout
// anymore and the indicator is noise. Updates once a second.
function TimeSinceLastSet({ anchorMs }: { anchorMs: number }) {
  // Tick 10x/sec; the displayed value reads Date.now() at render time
  // (NOT captured state), so any momentary JS-thread stall during a
  // mutation/persist can only delay the visible second-flip by up to
  // ~100ms before the next tick re-reads the clock. Empty deps keep the
  // interval alive across anchorMs changes.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((c) => c + 1), 100)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((Date.now() - anchorMs) / 1000))
  if (elapsed > 1800) return null
  let label: string
  if (elapsed < 60) {
    label = `${elapsed}s`
  } else {
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    label = `${m}m ${s}s`
  }
  return <Text style={styles.timeSinceLastSet}>{label} since last set</Text>
}

function formatRest(prevIso: string | null | undefined, curIso: string): string | null {
  if (!prevIso) return null
  const diff = (Date.parse(curIso) - Date.parse(prevIso)) / 1000
  // Mirror the live ticker's 30-min cap: a gap longer than that isn't rest
  // between sets (e.g. set 1 anchored to another exercise logged hours
  // earlier in the day), so suppress the label instead of showing "1951m".
  if (!Number.isFinite(diff) || diff <= 30 || diff > 1800) return null
  if (diff < 60) return `${Math.round(diff)}s`
  const m = Math.floor(diff / 60)
  const s = Math.round(diff % 60)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

// Enable LayoutAnimation on Android (iOS has it on by default).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// Animate the next layout change — used right before any mutation that
// adds or removes a set from the list, so the new row eases in / the
// removed row collapses smoothly instead of just popping in/out.
// LayoutAnimation runs on the JS driver. The set rows contain a legacy
// Swipeable whose `progress`/`dragX` Animated.Values are native-driven and
// bound to nested view opacities/transforms. Animating `opacity` here on
// create/delete reliably collides with those native nodes ("Attempting to
// run JS driven animation on animated node that has been moved to native"),
// so we use `scaleXY` instead — visually similar (rows pop in/out) and not
// shared with any native binding.
// Per-section durations: rows settle in with a soft spring (alive without
// being bouncy); both `delete` and `update` use easeInEaseOut so the
// disappearing row's collapse and the neighbour-shift flow as one motion,
// matched to the row's own opacity+translateY exit (~180ms total).
const SET_ANIM = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.spring,
    springDamping: 0.78,
    property: LayoutAnimation.Properties.scaleXY,
    duration: 260,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 220,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
    duration: 180,
  },
} as const

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
const EX_NOTE_REVEAL_MS = 260

// The "Last time" card's collapse. Height is a layout property, so it runs on
// the JS driver — see the save path, which holds the store mutation back for
// this long when the card is collapsing so the shrink has a clear thread.
const LAST_TIME_COLLAPSE_MS = 190

// Layout half of that reveal: the downward shift of everything under the
// note row. No `create`/`delete` sections, so only views that already exist
// animate. See the reveal state for why this is not a height animation.
const EX_NOTE_SHIFT_ANIM = {
  duration: EX_NOTE_REVEAL_MS,
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: EX_NOTE_REVEAL_MS,
  },
} as const

const EMPTY_HISTORY: ExerciseHistoryDay[] = []

// Heaviest set from the most recent prior workout for this exercise, used to
// prefill the log-set form when there's nothing else to seed from. Skips the
// current workout's date so the previous session is what surfaces.
function lastWorkoutTopSet(
  exerciseId: number,
  currentWorkoutDate: string | null
): { weight: number; reps: number } | null {
  const history = getExerciseHistoryQ(exerciseId)
  for (const day of history) {
    if (currentWorkoutDate && day.date === currentWorkoutDate) continue
    const candidates = day.sets.filter(
      (s): s is typeof s & { weight: number; reps: number } =>
        s.weight != null && s.reps != null
    )
    if (candidates.length === 0) continue
    const top = candidates.reduce((b, s) => (s.weight > b.weight ? s : b))
    return { weight: top.weight, reps: top.reps }
  }
  return null
}

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
// `skipFade`: mounts at full opacity instead of fading in. Used when a real
//   row is replacing an optimistic placeholder — the placeholder already
//   showed the fade, so the real row should appear seamlessly.
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
        <Text style={[styles.setIndex, isPr && { color: "#e0c050" }]}>
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
          isPr && { color: "#e0c050" },
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

function SetRowFade({
  children,
  leaving,
  skipFade,
}: {
  children: ReactNode
  leaving?: boolean
  skipFade?: boolean
}) {
  const opacity = useRef(new Animated.Value(skipFade ? 1 : 0)).current
  // Small translateY so rows visibly settle into / lift out of place
  // instead of just changing opacity in a fixed slot. Distance is kept
  // tiny (6px) so it reads as polish, not a slide.
  const translateY = useRef(new Animated.Value(skipFade ? 0 : 6)).current
  useEffect(() => {
    if (skipFade) return
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
    // Only run on mount — skipFade is captured at mount via useRef's initial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!leaving) return
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -4,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }, [leaving, opacity, translateY])
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  )
}
type Metric = "one_rm" | "heaviest" | "avg_weight" | "per_set"

const METRIC_OPTIONS: {
  id: Metric
  label: string
}[] = [
  { id: "per_set", label: "Per Set" },
  { id: "heaviest", label: "Heaviest" },
  { id: "one_rm", label: "1RM" },
  { id: "avg_weight", label: "Avg Weight" },
]

const SET_INDEX_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
]

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
  // non-first-paint subtrees (e.g. the always-mounted NoteEditorSheet Modal)
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
  const isCardio = we?.exercise.category === "cardio"
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
  const history: ExerciseHistoryDay[] = useMemo(() => {
    if (exerciseId == null || !needsHistory) return EMPTY_HISTORY
    return getExerciseHistoryQ(exerciseId)
  }, [snapshot, exerciseId, needsHistory])

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
    let latest: string | null = null
    for (const otherWe of realByDate.exercises) {
      if (skipWeId !== null && otherWe.id === skipWeId) continue
      for (const s of otherWe.sets) {
        if (s.is_planned) continue
        if (latest === null || Date.parse(s.created_at) > Date.parse(latest)) {
          latest = s.created_at
        }
      }
    }
    return latest
  }, [snapshot, workout?.date, route.params?.pendingCreate?.date, realWe?.id])

  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet

  // Lazy initializer: when there's nothing seeding the form yet (no planned
  // set, no sets in this session), pull the top set (heaviest weight) from
  // the most recent prior workout for this exercise. Runs once at mount.
  const [weight, setWeight] = useState<number>(() => {
    if (seed?.weight != null) {
      return isCardio ? seed.weight : roundForDisplay(fromKg(seed.weight, unit), unit)
    }
    const top = exerciseId != null ? lastWorkoutTopSet(exerciseId, workout?.date ?? null) : null
    if (isCardio) return top?.weight ?? 20
    return roundForDisplay(fromKg(top?.weight ?? 0, unit), unit)
  })
  const [reps, setReps] = useState<number>(() => {
    if (seed?.reps != null) return seed.reps
    const top = exerciseId != null ? lastWorkoutTopSet(exerciseId, workout?.date ?? null) : null
    if (isCardio) return top?.reps ?? 5
    return top?.reps ?? 8
  })
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
  // the Save click instead of waiting for the heavy mutation/commit. When
  // the real row lands, we drop the placeholder and mark the new set's id
  // for `skipFade` so it appears at full opacity (no double-fade flicker).
  // `baseIds` snapshots the set ids at click-time — that's how we detect the
  // new row even if a concurrent delete keeps `sets.length` unchanged.
  // Flipped on the click frame by a save that logs a set, so the "Last time"
  // card can start collapsing under the finger instead of waiting for the
  // store commit two frames later. Never cleared: once the store catches up,
  // `sets` says the same thing, and a fresh screen starts false again.
  const [optimisticLogged, setOptimisticLogged] = useState(false)

  const [pendingAdd, setPendingAdd] = useState<{
    weight: number
    reps: number
    key: number
    baseLen: number
    baseIds: Set<number>
    isPr: boolean
    isPosPr: boolean
    position: number
  } | null>(null)
  const pendingAddRef = useRef(pendingAdd)
  useEffect(() => {
    pendingAddRef.current = pendingAdd
  }, [pendingAdd])

  // On leave, if the user never logged a set on this exercise, drop the
  // empty WE so it doesn't litter the day's view as a ghost "Add first set"
  // card. We hook `beforeRemove` (not the unmount cleanup) so the store
  // mutation lands *before* the back-transition animation starts —
  // otherwise DayScreen flashes the empty card for the duration of the
  // animation. If the exercise was the only thing on a freshly-created
  // workout (no gym, no started_at, not planned), delete the workout too.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
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
      const isSideEffectWorkout =
        isOnlyExercise &&
        !w.started_at &&
        !w.gym &&
        !w.notes &&
        w.status !== "planned"
      if (isSideEffectWorkout) {
        deleteWorkout(workoutId)
      } else {
        api.removeExerciseFromWorkout(workoutId, weId)
      }
    })
    return unsub
  }, [navigation, workoutId, weId])

  // Stable identity so HistoryDayCard's `onPressDate` prop doesn't change on
  // unrelated parent re-renders, keeping the memoized day cards from
  // re-rendering during scroll.
  const openCalendarAtDate = useCallback(
    (date: string) => {
      // Disable the back-slide animation just for this transition so the
      // Calendar appears immediately. The screen is being popped, so this
      // option change has no lingering effect — fresh pushes start a new
      // SetLogger instance with default options.
      navigation.setOptions({ animation: "none" })
      navigation.navigate("Main", { screen: "Calendar", params: { date } })
    },
    [navigation]
  )

  // Summary-tab date taps push CalendarDate on top of the stack instead of
  // jumping to the Calendar tab. The tab jump pops SetLogger and unfreezes
  // every pre-mounted tab on the same frame (a visible "sec" freeze); a stack
  // push keeps MainTabs frozen, so the calendar opens instantly and the
  // workout stays underneath. Mirrors ExerciseDetail's openCalendarAtDate.
  const showSummaryTab = useCallback(() => setTab("summary"), [])

  const pushCalendarAtDate = useCallback(
    (date: string) => {
      navigation.navigate("CalendarDate", { date })
    },
    [navigation]
  )

  const [skipFadeIds, setSkipFadeIds] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    if (!pendingAdd || !pendingAdd.baseIds) return
    const baseIds = pendingAdd.baseIds
    const newSet = sets.find((s) => !baseIds.has(s.id))
    if (!newSet) return
    setSkipFadeIds((prev) => {
      const n = new Set(prev)
      n.add(newSet.id)
      return n
    })
    // Hold the placeholder visible until its fade-in fully completes
    // (~220ms) before dropping it. If we cleared `pendingAdd` the moment
    // the real row arrived (often <50ms in), the placeholder unmounts
    // mid-fade and the real row pops in at full opacity — a visible jump
    // from partial opacity to 1. Waiting out the fade means the swap
    // happens at opacity 1 on both sides, so it's invisible.
    const t = setTimeout(() => setPendingAdd(null), 240)
    return () => clearTimeout(t)
  }, [sets, pendingAdd])

  // Fade-then-mutate for delete: the row fades to 0 on the UI thread first,
  // and api.deleteSet only fires after the fade completes — so the user
  // never sees the JS thread freeze before the visual response.
  const [leavingIds, setLeavingIds] = useState<Set<number>>(() => new Set())
  const leavingIdsRef = useRef(leavingIds)
  useEffect(() => {
    leavingIdsRef.current = leavingIds
  }, [leavingIds])
  function startDelete(id: number) {
    startDeleteMany([id])
  }

  function startDeleteMany(ids: number[]) {
    if (ids.length === 0) return
    if (editingSetId != null && ids.includes(editingSetId)) cancelEdit()
    setLeavingIds((prev) => {
      const n = new Set(prev)
      for (const id of ids) n.add(id)
      return n
    })
    // 180ms matches the SetRowFade leaving fade so the LayoutAnimation
    // collapse fires the moment the rows reach opacity 0 — not earlier
    // (would visibly cut a half-faded row) and not noticeably later.
    setTimeout(() => {
      animateNext()
      // One index rebuild and one re-render for the whole batch. Deleting
      // N sets one call at a time recomputes PRs, rebuilds indexes and
      // re-renders N times back to back, which locks the UI for the length
      // of the burst — the freeze on a multi-set delete.
      batchMutations(() => {
        for (const id of ids) api.deleteSet(id)
      })
      setLeavingIds((prev) => {
        const n = new Set(prev)
        let changed = false
        for (const id of ids) {
          if (n.delete(id)) changed = true
        }
        return changed ? n : prev
      })
    }, 180)
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
    api.updateSet(id, { note }).catch(() => {})
  }

  // Note about this exercise on this day. Separate from a set's own note and
  // from the session note on the workout.
  // The menu hangs off the header button, so it needs the button's position in
  // window coordinates — a padding guess is wrong the moment the safe-area
  // inset changes. Measured on press, handed to a Modal, which shares that
  // coordinate space.
  const menuBtnRef = useRef<View | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  function openMenu() {
    menuBtnRef.current?.measureInWindow((x, y, w, h) => {
      setMenuAnchor({
        top: y + h + 6,
        right: Math.max(8, Dimensions.get("window").width - (x + w)),
      })
      setMenuOpen(true)
    })
  }
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
    setExerciseNote(we.id, exNoteDraft)
  }

  // A note needs a real workout_exercise row to hang on. On the pendingCreate
  // path that row lands right after the first set is saved, so until then the
  // header menu's note item is disabled and says why.
  const exNoteShown = (we?.id ?? -1) > 0

  // Smooth edit-mode transition. Single Animated.Value, fully native-driven
  // (scale + opacity). The "white border while editing" effect is done via
  // an absolute-positioned overlay whose opacity rides this value — mixing
  // native + JS drivers on the same Animated.View throws "JS driven
  // animation on animated node that has been moved to native" at runtime
  // (borderColor isn't natively animatable, but opacity is). Native driver
  // also makes the transition immune to the SetList re-render that fires
  // right after setEditingSetId(null).
  const editAnim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(editAnim, {
      toValue: editingSetId != null ? 1 : 0,
      duration: EDIT_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [editingSetId, editAnim])

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
    let anchor: string | null = prevWorkoutLastSetIso
    for (const other of sets) {
      if (other.id === s.id) break
      if (!other.is_planned) anchor = other.created_at
    }
    setEditingRestAnchorIso(anchor)
    const computed = anchor
      ? Math.max(0, Math.round((Date.parse(s.created_at) - Date.parse(anchor)) / 1000))
      : 0
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

  useEffect(() => {
    const anim = Animated.timing(restReveal, {
      toValue: restShown ? 1 : 0,
      duration: EDIT_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false, // height can't run on the native driver
    })
    anim.start()
    return () => anim.stop()
  }, [restShown, restReveal])

  function onFieldLayout(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h > 0) setFieldHeight((prev) => (prev === h ? prev : h))
  }

  function toggleSelected(id: number) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id]
    setSelectedIds(next)
  }

  function clearSelection() {
    setSelectedIds([])
  }

  function confirmDeleteSelected() {
    if (selectedIds.length === 0) return
    const count = selectedIds.length
    Alert.alert(
      `Delete ${count} set${count === 1 ? "" : "s"}?`,
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

  function save() {
    Keyboard.dismiss()
    setError(null)
    // Whether the day already had a logged set before this save. Authoring a
    // planned workout does not count: those are targets, not a session.
    const hadLoggedSet = sets.some((s) => !s.is_planned)
    if (reps <= 0) {
      setError(isCardio ? "Set a level of at least 1." : "Add at least 1 rep to log this set.")
      return
    }
    if (weight < 0) {
      setError(isCardio ? "Time can’t be negative." : "Weight can’t be negative.")
      return
    }
    if (isCardio && weight <= 0) {
      setError("Set a time of at least 1 minute.")
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
          ? new Date(Date.parse(anchor) + restSec * 1000).toISOString()
          : null
        setEditingSetId(null)
        setEditingRestAnchorIso(null)
        setTimeout(() => {
          if (editingPlanned) {
            logPlannedSet(id, { weight: w, reps: r })
          } else {
            api.updateSet(id, {
              weight: w,
              reps: r,
              ...(newCreatedAt ? { created_at: newCreatedAt } : {}),
            })
          }
        }, EDIT_MS + 40)
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
        })
        requestAnimationFrame(() => {
          api.addPlannedSet(weId, { weight: w, reps: r })
        })
      } else {
        const queued = sets.find((s) => s.is_planned)
        if (queued) {
          // Logging against a planned set: same row, fade weight/reps update
          // would be jarring — skip animation.
          setOptimisticLogged(true)
          logPlannedSet(queued.id, { weight: isCardio ? weight : toKg(weight, unit), reps })
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
          // The first logged set of the day collapses the "Last time" card.
          // Flipping this on the click frame is what starts that collapse
          // under the finger; the card animates its own height, so there is
          // no LayoutAnimation to configure here.
          const willCollapseCard = !optimisticLogged && !hadLoggedSet
          setOptimisticLogged(true)
          setPendingAdd({
            weight: w,
            reps: r,
            key: Date.now(),
            baseLen: sets.length,
            baseIds: new Set(sets.map((s) => s.id)),
            isPr: pr.isPr,
            isPosPr: pr.isPosPr,
            position: pr.position,
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
          // Normally one frame is enough of a head start. On the first set of
          // the day it is not: the "Last time" card is collapsing, that is a
          // height animation on the JS driver, and this commit — PR recompute,
          // index rebuild, full list re-render — would stall it half way. Hold
          // it back past the collapse instead. Nothing visible waits on it:
          // the placeholder row is already on screen from the click frame.
          // Same trick as the edit-mode save above.
          const runMutation = () => {
            if (wasResolved) {
              api.addSet(wasResolved.weId, { weight: w, reps: r })
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
            LayoutAnimation.configureNext(EX_NOTE_SHIFT_ANIM)
            setResolved(ids)
            api.addSet(ids.weId, { weight: w, reps: r })
          }
          if (willCollapseCard) {
            setTimeout(runMutation, LAST_TIME_COLLAPSE_MS + 40)
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
    <StaticSafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* In-screen back chevron — same look as the DayScreen date-nav arrows.
       *  The native stack header is hidden for this route because iOS adds
       *  its own circular press-state highlight that we can't override. */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerBackBtn,
            { transform: [{ scale: pressed ? 0.85 : 1 }] },
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={theme.colors.foreground}
          />
        </Pressable>
        <Pressable
          ref={menuBtnRef}
          onPress={openMenu}
          hitSlop={8}
          unstable_pressDelay={0}
          style={({ pressed }) => [
            styles.headerMenuBtn,
            pressedStyle(pressed),
          ]}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={theme.colors.foreground}
          />
        </Pressable>
      </View>
      {/* Fixed header + form so the layout doesn't reflow when sets are added.
       *  Pressable wrapper so a tap on empty form-area background dismisses
       *  the keyboard — the numeric keypad has no return key, so without
       *  this the user has to drag the list to dismiss. */}
      <Pressable style={styles.fixedTop} onPress={() => Keyboard.dismiss()}>
        <View style={styles.titleWrap}>
          <Text style={styles.exerciseName}>{we.exercise.name}</Text>
          <Text style={styles.exerciseMeta}>{we.exercise.category}</Text>
          {/* Only when there is something to read. Writing the first one is
              the header menu's job — a standing "Add a note" prompt under
              every exercise name was more chrome than the screen carried. */}
          {!!we.note.trim() && (
            <Pressable
              onPress={openExerciseNote}
              hitSlop={8}
              style={styles.exNoteRow}
            >
              <Ionicons
                name="document-text-outline"
                size={12}
                color={theme.colors.muted}
              />
              {/* The wrapper takes the row's remaining width. exNoteText must
                  NOT: it is applied per line inside NotePreview's column,
                  where flex:1 makes every line stretch instead of stacking. */}
              <View style={styles.exNoteBody}>
                <NotePreview note={we.note} style={styles.exNoteText} />
              </View>
            </Pressable>
          )}
          {/* Hidden for the pendingCreate stub, whose id is -1: there is no
           *  workout_exercise row yet, so a note written here would be
           *  dropped without telling the user. The stub is replaced within a
           *  frame or two of the real row landing. */}
        </View>

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
          // The form <-> selection-bar swap: this wrapper's height animates
          // from the form's height down to the bar's (and back), so the set
          // list below visibly slides up to meet the bar and back down when
          // the selection clears. Both layers stay mounted the whole time,
          // absolutely positioned on top of each other, and cross-fade via
          // swapAnim - only their opacity and this wrapper's height ever
          // change, so nothing below this card re-lays out. The form side of
          // the height comes from the form's own measured height (see
          // onFormLayout), not a constant, so entering edit mode grows the
          // card instead of clipping its buttons.
          <Animated.View
            style={[
              { overflow: "hidden" },
              swapHeight != null && { height: swapHeight },
            ]}
          >
            <Animated.View
              onLayout={(e: LayoutChangeEvent) =>
                setBarHeight(e.nativeEvent.layout.height)
              }
              pointerEvents={selectionMode ? "auto" : "none"}
              style={[
                styles.card,
                styles.selectionBar,
                styles.swapLayer,
                { opacity: swapAnim, zIndex: selectionMode ? 2 : 1 },
              ]}
            >
              <Pressable
                onPress={clearSelection}
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
                    ? editingSetId != null ? "Time (editing)" : "Time"
                    : editingSetId != null ? "Weight (editing)" : "Weight"
                }
                unit={isCardio ? "min" : unit}
                value={weight}
                step={isCardio ? 1 : step}
                min={0}
                onChange={setWeight}
                allowDecimal
              />
              <View onLayout={onFieldLayout}>
                <NumericField
                  label={isCardio ? "Level" : "Reps"}
                  value={reps}
                  step={1}
                  min={0}
                  onChange={setReps}
                />
              </View>
              {showRestTime && (
                // Stays mounted and collapses to height 0 rather than
                // unmounting, so entering and leaving edit mode animates. The
                // negative margin cancels the card's `gap` while the row is
                // collapsed, so a hidden row adds nothing to the card.
                // fieldHeight comes from the Reps field - see its declaration.
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
                    onChange={setRestSec}
                  />
                </Animated.View>
              )}
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <PhaseButton
                  defaultLabel="Save"
                  altLabel="Update"
                  phase={editAnim}
                  onPress={save}
                  style={{ flex: 1 }}
                />
                <PhaseButton
                  defaultLabel="Clear"
                  altLabel="Cancel"
                  phase={editAnim}
                  variant="secondary"
                  onPress={() => {
                    if (editingSetId != null) {
                      cancelEdit()
                    } else {
                      setWeight(0)
                      setReps(0)
                      setError(null)
                    }
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </Animated.View>
          </Animated.View>
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
              selectedIds={selectedIds}
              pendingAdd={pendingAdd}
              leavingIds={leavingIds}
              skipFadeIds={skipFadeIds}
              onLongPress={(s) => {
                if (s.is_planned) return
                if (!selectedIds.includes(s.id)) toggleSelected(s.id)
              }}
              onSelectToggle={toggleSelected}
              onPlannedTap={(s) => setActivePlannedSet(s)}
              onEdit={startEdit}
              onAddNote={openNoteEditor}
              onDelete={(s) => startDelete(s.id)}
            />
          )}
          {tab === "workout" && firstPaintDone && showLastTime && (
            <LastTimePanel
              days={history}
              currentDate={workout.date}
              unit={unit}
              hasSets={sets.some((s) => !s.is_planned) || optimisticLogged}
              onPressDate={pushCalendarAtDate}
              onShowMore={showSummaryTab}
            />
          )}
          {tab === "graph" && <GraphPanel days={history} unit={unit} />}
          {tab === "summary" && (
            <SummaryPanel
              days={history}
              unit={unit}
              onPressDate={pushCalendarAtDate}
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
        <NoteEditorSheet
          visible={noteEditingSet != null}
          original={noteEditingSet?.note ?? ""}
          draft={noteDraft}
          onChangeDraft={setNoteDraft}
          onClose={closeNoteEditor}
          onSave={persistNote}
        />
      )}
      <HeaderMenu
        visible={menuOpen}
        anchor={menuAnchor}
        noteEnabled={exNoteShown}
        note={we.note}
        lastTimeOn={showLastTime}
        onToggleLastTime={() => {
          setMenuOpen(false)
          // Past the fade: the card appearing or leaving under a menu that is
          // still on screen reads as two things moving at once.
          setTimeout(
            () => api.updateSettings({ show_last_time: !showLastTime }),
            MENU_FADE_MS + 40
          )
        }}
        onClose={() => setMenuOpen(false)}
        onNote={() => {
          setMenuOpen(false)
          // Past the fade, like the date menu: opening the sheet mid-fade
          // puts two overlays on screen at once.
          setTimeout(openExerciseNote, MENU_FADE_MS + 40)
        }}
      />
      {firstPaintDone && (
        <NoteEditorSheet
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
          requestAnimationFrame(() => {
            logPlannedSet(s.id, { weight: w, reps: r })
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
    </StaticSafeAreaView>
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
    set != null
      ? isCardio
        ? `${set.weight ?? "—"} min × Lvl ${set.reps ?? "—"}`
        : `${formatWeight(set.weight ?? undefined, unit)} ${unit} × ${set.reps ?? "—"}`
      : ""
  return (
    <PopupModal
      visible={set != null}
      title={title}
      onClose={onClose}
      animationType="fade"
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
  const fg =
    variant === "secondary" ? theme.colors.foreground : theme.colors.foreground
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

function SubTabBar({ tab, onChange }: { tab: SubTab; onChange: (t: SubTab) => void }) {
  const items: { key: SubTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "workout", label: "Workout", icon: "barbell-outline" },
    { key: "history", label: "History", icon: "list-outline" },
    { key: "graph", label: "Graph", icon: "stats-chart-outline" },
    { key: "summary", label: "Summary", icon: "reader-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
  ]
  return (
    <View style={styles.subTabBar}>
      {items.map((it) => {
        const active = tab === it.key
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
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
  const [open, setOpen] = useState(false)
  const spin = useRef(new Animated.Value(0)).current
  const text = note.trim()

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(EXPAND_ANIM)
    setOpen((v) => {
      Animated.timing(spin, {
        toValue: v ? 0 : 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return !v
    })
  }, [spin])

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
      <Animated.View
        style={{
          transform: [
            {
              rotate: spin.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "180deg"],
              }),
            },
          ],
        }}
      >
        <Ionicons name="chevron-down" size={12} color={theme.colors.muted} />
      </Animated.View>
    </Pressable>
  )
}

/**
 * Best weight at each rep count, heaviest first. One row per rep count, so a
 * 5-rep best and an 8-rep best both survive; ties go to the harder set.
 */
function topRepRecords(
  days: ExerciseHistoryDay[],
  limit: number
): { reps: number; weightKg: number; date: string }[] {
  const best = new Map<number, { weightKg: number; date: string }>()
  for (const day of days) {
    for (const s of day.sets) {
      if (s.weight == null || s.reps == null) continue
      const cur = best.get(s.reps)
      // weightKey, not the raw kg: an imported 125 lb set holds 56.70 kg and a
      // typed one 56.699, so the raw compare let the noise decide the winner
      // and, in the sort below, jump ahead of the reps tiebreak.
      if (!cur || weightKey(s.weight) > weightKey(cur.weightKg)) {
        best.set(s.reps, { weightKg: s.weight, date: day.date })
      }
    }
  }
  return [...best.entries()]
    .map(([reps, v]) => ({ reps, weightKg: v.weightKg, date: v.date }))
    .sort(
      (a, b) => weightKey(b.weightKg) - weightKey(a.weightKg) || b.reps - a.reps
    )
    .slice(0, limit)
}

/**
 * "What happened before" for the tab you log from. Deliberately not the
 * Summary tab's layout — that one is a full day card with a set list and note
 * strips, and it would dwarf the form above it. Here the last session is a row
 * of chips and the records are three tight lines.
 *
 * Renders nothing when the exercise has no weight×reps history: a cardio
 * exercise has no top weights, and a first session has no last time.
 */
const LastTimePanel = memo(function LastTimePanel({
  days,
  currentDate,
  unit,
  hasSets,
  onPressDate,
  onShowMore,
}: {
  days: ExerciseHistoryDay[]
  /** The day being logged. Its own sets are already on screen above. */
  currentDate: string
  unit: "kg" | "lb"
  /** Whether the day being logged has a set yet. Drives the default height:
   *  the card earns its full size only while there is nothing above it. */
  hasSets: boolean
  onPressDate?: (date: string) => void
  /** Opens the Summary tab, which carries the full record table. */
  onShowMore?: () => void
}) {
  const last = useMemo(() => {
    for (const d of days) {
      // `>=` also skips a future-dated session, which is not a "last time".
      if (d.date >= currentDate) continue
      const sets = d.sets.filter(
        (s): s is typeof s & { weight: number; reps: number } =>
          s.weight != null && s.reps != null
      )
      if (sets.length) return { date: d.date, sets }
    }
    return null
  }, [days, currentDate])

  // Records include today: a set logged a minute ago can be the new best, and
  // seeing that land is the point.
  const top = useMemo(() => topRepRecords(days, 3), [days])

  // Open by default until the day has a set, then collapse to one line: the
  // question "what did I do last time" outlives the first set, but the space
  // it deserves does not. `null` means nobody has touched the chevron, so the
  // card still follows the session; one tap and the choice is the user's for
  // as long as the screen lives.
  const [manual, setManual] = useState<boolean | null>(null)
  // With no earlier session there is nothing to collapse to — the one-line
  // stand-in would be blank — so that card stays open for its records.
  const open = manual ?? (!hasSets || !last)

  const spin = useRef(new Animated.Value(open ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(spin, {
      toValue: open ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [open, spin])

  // The body is two stacked layers inside one box whose height eases between
  // their measured heights — the same trick as the form/selection-bar swap
  // above. LayoutAnimation was doing this job badly: on the save path the
  // only safe config is update-only, so the chips and records vanished on the
  // spot and just the empty box slid, which read as no animation at all.
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current
  const [collapsedH, setCollapsedH] = useState<number | null>(null)
  const [expandedH, setExpandedH] = useState<number | null>(null)
  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      // Closing is quicker: the user has already read it and wants the space.
      duration: open ? 240 : 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // height is a layout prop
    }).start()
  }, [open, progress])

  const bodyHeight =
    collapsedH != null && expandedH != null
      ? progress.interpolate({
          inputRange: [0, 1],
          outputRange: [collapsedH, expandedH],
        })
      : // Before the first measure: clip to the collapsed layer when closed
        // (it is absolute, so it still measures), natural height when open.
        open
          ? undefined
          : ((collapsedH ?? 0) as unknown as number)

  const toggle = useCallback(() => setManual((v) => !(v ?? open)), [open])

  if (!last && top.length === 0) return null

  const collapsedLine = last
    ? last.sets
        .map((s) => `${formatWeight(s.weight, unit)}×${s.reps}`)
        .join("   ")
    : ""

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
          <Text style={styles.lastTimeLabel}>Last time</Text>
          {last && <Text style={styles.lastTimeAgo}>{agoLabel(last.date)}</Text>}
          <Animated.View
            style={{
              transform: [
                {
                  rotate: spin.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "180deg"],
                  }),
                },
              ],
            }}
          >
            <Ionicons
              name="chevron-down"
              size={13}
              color={theme.colors.muted}
            />
          </Animated.View>
        </Pressable>
        {last && onPressDate && (
          <Pressable
            onPress={() => onPressDate(last.date)}
            hitSlop={10}
            unstable_pressDelay={0}
            style={({ pressed }) => [
              styles.lastTimeCalBtn,
              pressedStyle(pressed),
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={15}
              color={theme.colors.muted}
            />
          </Pressable>
        )}
      </View>

      <Animated.View
        style={[
          { overflow: "hidden" },
          bodyHeight != null && { height: bodyHeight },
        ]}
      >
        {/* Collapsed layer. Absolute, so it measures its own height without
            contributing to the box's natural height. */}
        <Animated.View
          onLayout={(e: LayoutChangeEvent) =>
            setCollapsedH(Math.round(e.nativeEvent.layout.height))
          }
          pointerEvents="none"
          style={[
            styles.lastTimeCollapsedLayer,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
            },
          ]}
        >
          {!!collapsedLine && (
            <Text style={styles.lastTimeSummary} numberOfLines={1}>
              {collapsedLine}
            </Text>
          )}
        </Animated.View>

        <Animated.View
          onLayout={(e: LayoutChangeEvent) =>
            setExpandedH(Math.round(e.nativeEvent.layout.height))
          }
          pointerEvents={open ? "auto" : "none"}
          style={{ opacity: progress, gap: theme.spacing[2] }}
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
                <View key={r.reps} style={styles.topRow}>
                  <Text style={styles.topWeight}>
                    {formatWeight(r.weightKg, unit)}
                    <Text style={styles.topUnit}> {unit}</Text>
                  </Text>
                  <Text style={styles.topReps}>
                    × {r.reps} {r.reps === 1 ? "rep" : "reps"}
                  </Text>
                  <Text style={styles.topDate}>{recordDate(r.date)}</Text>
                </View>
              ))}
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
            </>
          )}
        </Animated.View>
      </Animated.View>
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
          <Pressable
            onPress={() => onPressDate(day.date)}
            hitSlop={10}
            unstable_pressDelay={0}
            style={({ pressed }) => [
              styles.dayCardCalBtn,
              pressedStyle(pressed),
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={theme.colors.muted}
            />
          </Pressable>
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
  const past = useMemo(
    () => days.filter((d) => d.date <= currentDate),
    [days, currentDate]
  )
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
  const past = useMemo(
    () => days.filter((d) => d.date <= currentDate),
    [days, currentDate]
  )
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

function dayValueKg(
  day: ExerciseHistoryDay,
  metric: Metric,
  setIndex: number
): { value: number; reps: number } {
  const sets = day.sets.filter(
    (s): s is typeof s & { weight: number; reps: number } =>
      s.weight != null && s.reps != null
  )
  if (!sets.length) return { value: 0, reps: 0 }
  switch (metric) {
    case "one_rm": {
      const best = sets.reduce((b, s) =>
        s.estimated_one_rm > b.estimated_one_rm ? s : b
      )
      return { value: best.estimated_one_rm, reps: best.reps }
    }
    case "heaviest": {
      const best = sets.reduce((b, s) => (s.weight > b.weight ? s : b))
      return { value: best.weight, reps: best.reps }
    }
    case "avg_weight": {
      const totalReps = sets.reduce((sum, s) => sum + s.reps, 0)
      return {
        value: sets.reduce((sum, s) => sum + s.weight, 0) / sets.length,
        reps: totalReps,
      }
    }
    case "per_set": {
      const target = sets[setIndex - 1]
      if (!target) return { value: 0, reps: 0 }
      return { value: target.weight, reps: target.reps }
    }
  }
}

export function GraphPanel({ days, unit }: { days: ExerciseHistoryDay[]; unit: "kg" | "lb" }) {
  const [metric, setMetric] = useState<Metric>("per_set")
  const [setIndex, setSetIndex] = useState<number>(1)
  const points = useMemo(
    () =>
      days
        .map((d) => {
          const dv = dayValueKg(d, metric, setIndex)
          return {
            date: d.date,
            value: roundForDisplay(fromKg(dv.value, unit), unit),
            reps: dv.reps,
          }
        })
        .filter((p) => p.value > 0)
        .sort(
          (a, b) =>
            new Date(a.date + "T00:00:00").getTime() -
            new Date(b.date + "T00:00:00").getTime()
        ),
    [days, metric, setIndex, unit]
  )

  const opt = METRIC_OPTIONS.find((m) => m.id === metric)!
  const headerLabel =
    metric === "heaviest"
      ? "Heaviest set"
      : metric === "per_set"
        ? `${SET_INDEX_OPTIONS.find((s) => s.value === setIndex)!.label} set`
        : opt.label

  if (points.length === 0) {
    const emptyMessage =
      metric === "per_set"
        ? `No ${SET_INDEX_OPTIONS.find((s) => s.value === setIndex)!.label} sets logged yet.`
        : `No data for ${opt.label.toLowerCase()} yet.`
    return (
      <View style={styles.graphWrap}>
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartEyebrow}>{headerLabel}</Text>
              <View style={styles.chartValueRow}>
                <Text style={styles.chartValue}>—</Text>
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
            <Text style={styles.chartLegendText}>—</Text>
          </View>

          <View style={styles.chartEmpty}>
            <Text style={styles.emptyText}>{emptyMessage}</Text>
          </View>

          <View style={styles.chartStats}>
            <Stat label="Peak" value="—" unit={unit} accent="green" />
            <Stat label="Average" value="—" unit={unit} accent="muted" />
            <Stat label="Latest" value="—" unit={unit} accent="primary" />
          </View>
        </View>

        <View style={styles.metricPanel}>
          <Text style={styles.metricPanelLabel}>Metric</Text>
          <MetricSwitcher metric={metric} onChange={setMetric} />
          {metric === "per_set" && (
            <SetIndexSwitcher setIndex={setIndex} onChange={setSetIndex} />
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
              <Text style={styles.chartValue}>{fmtMetric(latest.value, metric)}</Text>
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
                  {fmtMetric(delta, metric)} since first
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
          <Stat label="Peak" value={fmtMetric(peak, metric)} unit={unit} accent="green" />
          <Stat label="Average" value={fmtMetric(avg, metric)} unit={unit} accent="muted" />
          <Stat label="Latest" value={fmtMetric(latest.value, metric)} unit={unit} accent="primary" />
        </View>
      </View>

      <View style={styles.metricPanel}>
        <Text style={styles.metricPanelLabel}>Metric</Text>
        <MetricSwitcher metric={metric} onChange={setMetric} />
        {metric === "per_set" && (
          <SetIndexSwitcher setIndex={setIndex} onChange={setSetIndex} />
        )}
      </View>
    </View>
  )
}

type ChartPoint = { date: string; value: number; reps: number }

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
  const SECTIONS = 4

  const screenWidth = Dimensions.get("window").width
  const visibleW = screenWidth - theme.spacing[4] * 4 - Y_AXIS_W
  const naturalW = INITIAL + Math.max(0, points.length - 1) * POINT_SPACING + END
  const contentW = Math.max(visibleW, naturalW)

  const values = points.map((p) => p.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const rawSpan = Math.max(1, maxVal - minVal)
  const roughStep = rawSpan / SECTIONS
  const niceStep =
    roughStep <= 5
      ? 5
      : roughStep <= 10
        ? 10
        : roughStep <= 25
          ? 25
          : roughStep <= 50
            ? 50
            : Math.ceil(roughStep / 100) * 100
  const yMin = Math.max(0, Math.floor(minVal / niceStep) * niceStep)
  const yMax = Math.ceil(maxVal / niceStep) * niceStep + (maxVal === minVal ? niceStep : 0)
  const ySections = Math.max(1, Math.round((yMax - yMin) / niceStep))

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

  const yTickValues: number[] = []
  for (let s = 0; s <= ySections; s++) {
    yTickValues.push(yMax - s * niceStep)
  }

  const labelIndices: number[] = []
  const labelCount = Math.min(5, points.length)
  for (let k = 0; k < labelCount; k++) {
    const denom = Math.max(1, labelCount - 1)
    labelIndices.push(Math.round((k * (points.length - 1)) / denom))
  }
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
              {fmtMetric(v, metric)}
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
                  stroke="rgba(255,255,255,0.06)"
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
                stroke="rgba(255,255,255,0.22)"
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
                {fmtMetric(active.value, metric)} {unit}
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

function SetIndexSwitcher({
  setIndex,
  onChange,
}: {
  setIndex: number
  onChange: (n: number) => void
}) {
  return (
    <View style={[styles.metricSwitcher, { marginTop: 8 }]}>
      {SET_INDEX_OPTIONS.map((s) => {
        const active = setIndex === s.value
        return (
          <Pressable
            key={s.value}
            onPress={() => onChange(s.value)}
            style={({ pressed }) => [
              styles.metricButton,
              active && styles.metricButtonActive,
              pressed && styles.metricButtonPressed,
            ]}
          >
            <Text style={[styles.metricButtonText, active && styles.metricButtonTextActive]}>
              {s.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function MetricSwitcher({
  metric,
  onChange,
}: {
  metric: Metric
  onChange: (m: Metric) => void
}) {
  return (
    <View style={styles.metricSwitcher}>
      {METRIC_OPTIONS.map((m) => {
        const active = metric === m.id
        return (
          <Pressable
            key={m.id}
            onPress={() => onChange(m.id)}
            style={({ pressed }) => [
              styles.metricButton,
              active && styles.metricButtonActive,
              pressed && styles.metricButtonPressed,
            ]}
          >
            <Text style={[styles.metricButtonText, active && styles.metricButtonTextActive]}>
              {m.label}
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

function fmtMetric(value: number | undefined, _metric: Metric): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function shortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
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
const GOLD = "#facc15"

// How the rep-record rows are ordered, and what the bar in each row measures.
// The bar always tracks the active sort, so the list reads as one shape.
type RepSort = "weight" | "oneRm" | "reps" | "recent"
const REP_SORTS: { key: RepSort; label: string; hint: string }[] = [
  { key: "weight", label: "Heaviest", hint: "Top weight first" },
  { key: "oneRm", label: "Best 1RM", hint: "Strongest set first" },
  { key: "reps", label: "Most reps", hint: "Highest rep count first" },
  { key: "recent", label: "Recent", hint: "Newest record first" },
]

// Rows shown before the "Show all" toggle is tapped.
const REP_ROWS_COLLAPSED = 3

// Expand/collapse inside the Summary tab — the "Show all" rep rows and the
// collapsible notes. Revealed content fades in while the container height
// eases, so each toggle reads as one motion instead of a jump. Opacity is safe
// here (unlike SET_ANIM): the Summary tab never mounts the swipeable set list,
// so there are no native-driven Animated nodes for it to collide with.
const EXPAND_ANIM = {
  duration: 260,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 240,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 260,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 160,
  },
} as const

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
  const lastDay = useMemo(() => {
    const today = todayString()
    for (const d of days) {
      // Never a session that has not happened yet. A workout dated in the
      // future can carry logged sets, and it sorts to the front — the History
      // tab drops those days for the same reason.
      if (d.date > today) continue
      if (excludeDate && d.date >= excludeDate) continue
      return d
    }
    return null
  }, [days, excludeDate])

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
  const wrSets = useMemo(() => {
    const out: { weightKg: number; reps: number; setNum: number; date: string; oneRm: number }[] = []
    for (const day of days) {
      for (const s of day.sets) {
        if (s.weight == null || s.reps == null) continue
        out.push({
          weightKg: s.weight,
          reps: s.reps,
          setNum: s.order + 1,
          date: day.date,
          oneRm: s.estimated_one_rm,
        })
      }
    }
    return out
  }, [days])

  // Set numbers actually performed, ascending. Drives the picker; never padded.
  const setNumbers = useMemo(() => {
    const nums = new Set<number>()
    for (const s of wrSets) nums.add(s.setNum)
    return [...nums].sort((a, b) => a - b)
  }, [wrSets])

  // "all" pools every position; otherwise restrict to one set number.
  const [scope, setScope] = useState<"all" | number>("all")
  const [sort, setSort] = useState<RepSort>("weight")
  const [showAllRows, setShowAllRows] = useState(false)
  const [picker, setPicker] = useState<"scope" | "sort" | null>(null)
  // The day whose sets the record popup is showing, or null when closed.
  const [recordDay, setRecordDay] = useState<ExerciseHistoryDay | null>(null)

  // Drives the "Show all" chevron flip. Separate from the LayoutAnimation
  // because it is a transform, which LayoutAnimation cannot animate.
  const moreSpin = useRef(new Animated.Value(0)).current
  const toggleShowAllRows = useCallback(() => {
    LayoutAnimation.configureNext(EXPAND_ANIM)
    setShowAllRows((v) => {
      Animated.timing(moreSpin, {
        toValue: v ? 0 : 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return !v
    })
  }, [moreSpin])

  // Collapse back to the top rows whenever the list itself changes shape.
  const resetRows = useCallback(() => {
    setShowAllRows(false)
    moreSpin.setValue(0)
  }, [moreSpin])

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
  const repRows = useMemo(() => {
    const best = new Map<
      number,
      { weightKg: number; date: string; count: number }
    >()
    for (const s of scoped) {
      const cur = best.get(s.reps)
      if (!cur) {
        best.set(s.reps, { weightKg: s.weightKg, date: s.date, count: 1 })
        continue
      }
      cur.count += 1
      if (weightKey(s.weightKg) > weightKey(cur.weightKg)) {
        cur.weightKg = s.weightKg
        cur.date = s.date
      }
    }
    const rows = [...best.entries()].map(([reps, v]) => ({
      reps,
      weightKg: v.weightKg,
      date: v.date,
      count: v.count,
      oneRmKg: estimateOneRm(v.weightKg, reps),
    }))

    // `metric` is what the bar measures — always the active sort, so the bar
    // lengths and the row order tell the same story. "Recent" has no useful
    // magnitude, so it falls back to weight.
    // Weight is measured as weightKey so equal-looking weights really tie and
    // the reps tiebreak below gets to decide. `share` is a ratio against
    // maxMetric, so the x100 scale cancels out and the bars are unaffected.
    const metric = (r: (typeof rows)[number]) =>
      sort === "reps"
        ? r.reps
        : sort === "oneRm"
          ? r.oneRmKg
          : weightKey(r.weightKg)

    rows.sort((a, b) => {
      if (sort === "recent") {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1
        return weightKey(b.weightKg) - weightKey(a.weightKg)
      }
      const diff = metric(b) - metric(a)
      // Ties break on the harder set: more reps at the same weight.
      return diff !== 0 ? diff : b.reps - a.reps
    })

    const maxMetric = rows.reduce((m, r) => (metric(r) > m ? metric(r) : m), 0)

    // The single strongest row, by index rather than by value: several rep
    // counts can estimate to the same 1RM, and marking every tie made the
    // whole table gold. Ties go to the row that did more reps for it.
    let topIdx = -1
    for (let i = 0; i < rows.length; i++) {
      if (topIdx < 0) {
        topIdx = i
        continue
      }
      const best = rows[topIdx]
      if (rows[i].oneRmKg > best.oneRmKg) topIdx = i
      else if (rows[i].oneRmKg === best.oneRmKg && rows[i].reps > best.reps) {
        topIdx = i
      }
    }

    return rows.map((r, i) => ({
      ...r,
      share: maxMetric > 0 ? metric(r) / maxMetric : 0,
      isTopOneRm: i === topIdx,
    }))
  }, [scoped, sort])

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
              <Pressable
                onPress={() => onPressDate(lastDay.date)}
                hitSlop={10}
                unstable_pressDelay={0}
                style={({ pressed }) => [
                  styles.dayCardCalBtn,
                  pressedStyle(pressed),
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={theme.colors.muted}
                />
              </Pressable>
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
              onPress={() => setPicker("scope")}
            />
            <PickerTrigger
              icon="swap-vertical-outline"
              label={sortLabel}
              onPress={() => setPicker("sort")}
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
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: moreSpin.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0deg", "180deg"],
                        }),
                      },
                    ],
                  }}
                >
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color={theme.colors.primary}
                  />
                </Animated.View>
              </Pressable>
            )}
          </View>

          <OptionPickerOverlay
            visible={picker === "scope"}
            title="Show set"
            options={[
              {
                key: "all",
                label: "All sets",
                hint: `${wrSets.length} ${wrSets.length === 1 ? "set" : "sets"}`,
                active: scope === "all",
              },
              ...setNumbers.map((n) => {
                const count = wrSets.filter((s) => s.setNum === n).length
                return {
                  key: String(n),
                  label: `Set ${n}`,
                  hint: `${count} ${count === 1 ? "time" : "times"}`,
                  active: scope === n,
                }
              }),
            ]}
            onClose={() => setPicker(null)}
            onSelect={(key) => {
              setScope(key === "all" ? "all" : Number(key))
              resetRows()
              setPicker(null)
            }}
          />

          <OptionPickerOverlay
            visible={picker === "sort"}
            title="Sort by"
            options={REP_SORTS.map((s) => ({
              key: s.key,
              label: s.label,
              hint: s.hint,
              active: sort === s.key,
            }))}
            onClose={() => setPicker(null)}
            onSelect={(key) => {
              setSort(key as RepSort)
              resetRows()
              setPicker(null)
            }}
          />

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

const MENU_FADE_MS = 150

/**
 * The header's overflow menu. One item today — the exercise note — but it is
 * where a per-exercise action belongs now that the note prompt no longer sits
 * under the title.
 *
 * The note item is disabled until the day has a set. Before that there is no
 * workout_exercise row to hang a note on, so a note written then would be
 * dropped without telling anyone. The row says why rather than vanishing.
 */
function HeaderMenu({
  visible,
  anchor,
  noteEnabled,
  note,
  lastTimeOn,
  onClose,
  onNote,
  onToggleLastTime,
}: {
  visible: boolean
  /** Where the card's top-right corner goes, in window coordinates. Measured
   *  from the header button on press — a fixed padding is wrong as soon as
   *  the safe-area inset differs. */
  anchor: { top: number; right: number } | null
  noteEnabled: boolean
  /** The saved note. Only its emptiness matters here — it picks Add or Edit.
   *  The note itself reads under the exercise name. */
  note: string
  lastTimeOn: boolean
  onClose: () => void
  onNote: () => void
  onToggleLastTime: () => void
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1,
        duration: MENU_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: MENU_FADE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, opacity])

  if (!mounted || !anchor) return null

  const color = noteEnabled ? theme.colors.foreground : theme.colors.muted
  const hasNote = !!note.trim()

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop and card are siblings, not nested — one tap dismisses. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.menuBackdrop, { opacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      {/* Grows out of the button it hangs from, the way an iOS menu does:
          transformOrigin puts the anchor at the card's top-right corner, so
          the scale reads as the menu unfolding rather than zooming. */}
      <Animated.View
        style={[
          styles.menuCard,
          { top: anchor.top, right: anchor.right },
          {
            opacity,
            transformOrigin: "top right",
            transform: [
              {
                scale: opacity.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.85, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          onPress={noteEnabled ? onNote : undefined}
          disabled={!noteEnabled}
          style={({ pressed }) => [
            styles.menuRow,
            styles.menuRowBorder,
            pressed && noteEnabled && styles.menuRowPressed,
          ]}
        >
          <View style={styles.menuRowBody}>
            <Text style={[styles.menuRowText, { color }]} numberOfLines={1}>
              {hasNote ? "Edit exercise note" : "Add exercise note"}
            </Text>
            {!noteEnabled && (
              <Text style={styles.menuRowHint} numberOfLines={1}>
                Log a set first
              </Text>
            )}
          </View>
          <Ionicons name="document-text-outline" size={17} color={color} />
        </Pressable>

        <Pressable
          onPress={onToggleLastTime}
          style={({ pressed }) => [
            styles.menuRow,
            pressed && styles.menuRowPressed,
          ]}
        >
          <View style={styles.menuRowBody}>
            <Text style={styles.menuRowText} numberOfLines={1}>
              {lastTimeOn ? "Hide Last time card" : "Show Last time card"}
            </Text>
          </View>
          {/* An action row, like the note row above it — not a checkbox. A
              checkmark that turns into an empty box asks you to work out
              which state you are looking at; a label that names what the tap
              does, next to an icon that shows it, does not. */}
          <Ionicons
            name={lastTimeOn ? "eye-off-outline" : "eye-outline"}
            size={17}
            color={theme.colors.foreground}
          />
        </Pressable>
      </Animated.View>
    </Modal>
  )
}

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
  const opacity = useRef(new Animated.Value(0)).current
  const [shown, setShown] = useState<ExerciseHistoryDay | null>(day)

  // Leaving for the calendar skips the fade: a native Modal sits above the
  // whole app, so fading it out over the incoming screen would put 150ms of
  // dimmed backdrop on top of the push. Unmount it this commit, navigate on
  // the next frame. The pending fade-out's callback is guarded on `finished`,
  // so a reopen inside that window cannot blank the new content.
  const goToDate = useCallback(() => {
    if (!shown || !onPressDate) return
    const date = shown.date
    opacity.setValue(0)
    setShown(null)
    onClose()
    requestAnimationFrame(() => onPressDate(date))
  }, [shown, onPressDate, onClose, opacity])

  useEffect(() => {
    if (day) {
      setShown(day)
      Animated.timing(opacity, {
        toValue: 1,
        duration: PICKER_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: PICKER_FADE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(null)
    })
  }, [day, opacity])

  if (!shown) return null

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.pickerOverlay, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/* Backdrop and card are siblings, not nested — that is what keeps a
            single tap enough to dismiss.

            box-none, unlike the option picker's card: the set list below is
            plain Views, so nothing inside claims the touch, and a responder
            claimed here would block the list's native scroll gesture on a day
            with many sets. The option picker can claim it because each of its
            rows is a Pressable that takes the touch first. The cost is that a
            tap on this card's padding closes the popup — it is read-only, so
            that discards nothing. */}
        <View style={styles.pickerCard} pointerEvents="box-none">
          <View style={styles.recordDayHead}>
            <View style={styles.pickerTitleCol}>
              <Text style={styles.pickerTitle}>{niceDate(shown.date)}</Text>
              <ExpandableNote note={shown.note} />
            </View>
            {onPressDate && (
              <Pressable
                onPress={goToDate}
                hitSlop={10}
                unstable_pressDelay={0}
                style={({ pressed }) => [
                  styles.dayCardCalBtn,
                  pressedStyle(pressed),
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={theme.colors.muted}
                />
              </Pressable>
            )}
          </View>
          <ScrollView
            style={styles.pickerScroll}
            contentContainerStyle={styles.recordDaySets}
            showsVerticalScrollIndicator
          >
            <SharedSetList sets={shown.sets} showNotes />
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  )
}

/**
 * One note on the last-session card. Collapsed it is a single line — a label,
 * the first line of the note, a chevron. Tapping expands the full text. Notes
 * can run long, and rendering them all open pushed the sets off the screen.
 */
function CollapsibleNote({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const spin = useRef(new Animated.Value(0)).current
  const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? ""

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(EXPAND_ANIM)
    setOpen((v) => {
      Animated.timing(spin, {
        toValue: v ? 0 : 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return !v
    })
  }, [spin])

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
        <Animated.View
          style={{
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "180deg"],
                }),
              },
            ],
          }}
        >
          <Ionicons
            name="chevron-down"
            size={14}
            color={theme.colors.muted}
          />
        </Animated.View>
      </View>
      {open && <Text style={styles.summaryNoteText}>{text}</Text>}
    </Pressable>
  )
}

function PickerTrigger({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.setPickerTrigger, pressedStyle(pressed)]}
    >
      <Ionicons name={icon} size={13} color={theme.colors.muted} />
      <Text style={styles.setPickerTriggerText} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={14} color={theme.colors.muted} />
    </Pressable>
  )
}

// Centered, scrollable option picker. Mirrors NoteEditorSheet: the fade is
// a single JS-driven Animated opacity, so there's no react-native-modal
// backdrop transition to flicker on open/close. A core Modal hosts it only so
// it escapes SummaryPanel's ScrollView and centers on the screen — its native
// fade is disabled (animationType="none"); we mount it instantly and run our
// own fade, unmounting after the fade-out completes. The dimmed backdrop and
// the card are siblings (not nested), so a single tap closes/selects — nesting
// Pressables is what previously needed a double tap.
const PICKER_FADE_MS = 150
interface PickerOption {
  key: string
  label: string
  hint?: string
  active: boolean
}
function OptionPickerOverlay({
  visible,
  title,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean
  title: string
  options: PickerOption[]
  onClose: () => void
  onSelect: (key: string) => void
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1,
        duration: PICKER_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: PICKER_FADE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, opacity])

  if (!mounted) return null

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.pickerOverlay, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/* onStartShouldSetResponder absorbs taps on empty card area so they
            don't fall through to the backdrop; option Pressables still claim
            their own taps first. */}
        <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <ScrollView
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerScrollContent}
            showsVerticalScrollIndicator
          >
            {options.map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => onSelect(opt.key)}
                style={({ pressed }) => [
                  styles.setPickerOption,
                  opt.active && styles.setPickerOptionActive,
                  pressedStyle(pressed),
                ]}
              >
                <Text
                  style={[
                    styles.setPickerOptionText,
                    opt.active && { color: theme.colors.primary },
                  ]}
                >
                  {opt.label}
                </Text>
                {!!opt.hint && (
                  <Text style={styles.setPickerOptionCount}>{opt.hint}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  )
}

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}
function niceDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

// "Yesterday" / "6 days ago" / "3 weeks ago" for the last-session header. Both
// sides are floored to local midnight so the answer follows calendar days, not
// elapsed hours — a session 20 hours ago still reads "Yesterday".
function agoLabel(date: string): string {
  const then = new Date(date + "T00:00:00")
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - then.getTime()) / 86400000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return w === 1 ? "1 week ago" : `${w} weeks ago`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return m === 1 ? "1 month ago" : `${m} months ago`
  }
  const y = Math.floor(days / 365)
  return y === 1 ? "1 year ago" : `${y} years ago`
}

// Records show the year only when it differs from the current year (a PR can
// be years old) — dropped the weekday to keep it compact in the rep rows.
function recordDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = "numeric"
  return dt.toLocaleDateString("en-US", opts)
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
            const cleaned = t.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, "")
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

function SetList({
  sets,
  unit,
  isCardio,
  showOneRm,
  showPositionPrs,
  showRestTime,
  showTimeSinceLastSet,
  prevWorkoutLastSetIso,
  selectedIds,
  pendingAdd,
  leavingIds,
  skipFadeIds,
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
  } | null
  leavingIds: Set<number>
  skipFadeIds: Set<number>
  onLongPress: (s: WorkoutSet) => void
  onSelectToggle: (id: number) => void
  onPlannedTap: (s: WorkoutSet) => void
  onEdit: (s: WorkoutSet) => void
  onAddNote: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const selectionMode = selectedIds.length > 0
  const openSwipeableRef = useRef<Swipeable | null>(null)
  const swipeableRefs = useRef(new Map<number, Swipeable | null>())
  // Imperative close (no state, no re-renders) — fired from each
  // Swipeable's open-related callbacks. Whichever fires first does the
  // close; subsequent calls are no-ops because the ref is null.
  function closeOtherOpenRow(currentId: number) {
    const current = swipeableRefs.current.get(currentId) ?? null
    if (
      openSwipeableRef.current &&
      openSwipeableRef.current !== current
    ) {
      openSwipeableRef.current.close()
      openSwipeableRef.current = null
    }
  }

  if (!sets.length && !pendingAdd) {
    // Even with nothing logged here, keep the ticker visible when there's a
    // logged set elsewhere in this workout — bench → pushdowns shouldn't
    // reset the user's rest clock until they actually log on pushdowns.
    const emptyAnchorMs = prevWorkoutLastSetIso
      ? Date.parse(prevWorkoutLastSetIso)
      : NaN
    return (
      <View>
        <View style={[styles.card, { borderStyle: "dashed", alignItems: "center" }]}>
          <Text style={{ color: theme.colors.muted, fontSize: theme.fontSize.sm }}>
            No sets logged yet. Log your first set above.
          </Text>
        </View>
        {showTimeSinceLastSet && Number.isFinite(emptyAnchorMs) && (
          <TimeSinceLastSet anchorMs={emptyAnchorMs} />
        )}
      </View>
    )
  }
// Per-row rest labels. Anchor on the most recent prior *logged* set:
  // planned rows have synthetic created_at and shouldn't anchor real rest.
  // Set 1's rest comes from the last set of the previous workout.
  const restLabels: (string | null)[] = []
  {
    let lastRealIso: string | null = prevWorkoutLastSetIso
    for (const s of sets) {
      if (s.is_planned) {
        restLabels.push(null)
      } else {
        restLabels.push(formatRest(lastRealIso, s.created_at))
        lastRealIso = s.created_at
      }
    }
  }

  // Keep the placeholder visible the entire time `pendingAdd` is set —
  // including the held-open window (~240ms) after the real row arrives.
  // The parent delays `setPendingAdd(null)` until the placeholder's
  // fade-in is complete, so when the placeholder finally unmounts here
  // it's at full opacity, and the real row appears at full opacity via
  // `skipFade` — no jump.
  const showPlaceholder = pendingAdd != null

  return (
    <View style={styles.setListCard}>
      {sets.map((s, i) => {
        // Hide the new real row only while the placeholder is still showing.
        // Once `realArrivedBeforeCleanup` is true (placeholder dropped),
        // we let the new row render — with `skipFade` so it appears at full
        // opacity rather than fading in over the placeholder's exit.
        const isNewlyAdded =
          pendingAdd != null &&
          pendingAdd.baseIds != null &&
          !pendingAdd.baseIds.has(s.id)
        if (showPlaceholder && isNewlyAdded) return null

        function closeThen(action: () => void) {
          const current = swipeableRefs.current.get(s.id) ?? null
          current?.close()
          if (openSwipeableRef.current === current) {
            openSwipeableRef.current = null
          }
          action()
        }

        const oneRm = !s.is_planned ? estimateOneRm(s.weight, s.reps) : 0
        const isSelected = selectedIds.includes(s.id)
        const isPr = !!s.is_pr
        const wasPr = !s.is_pr && !!s.was_pr
        const isPosPr = !s.is_pr && !s.was_pr && !!s.is_position_pr
        const wasPosPr =
          !s.is_pr && !s.was_pr && !s.is_position_pr && !!s.was_position_pr
        const isLast = i === sets.length - 1
        const leaving = leavingIds?.has(s.id) ?? false
        // `isNewlyAdded` (computed above) means the placeholder was just
        // swapped out for this row — mount it at full opacity instead of
        // fading in, since the placeholder already showed the user the
        // row's content. After this render, the useEffect will mirror this
        // into `skipFadeIds` for subsequent renders.
        const skipFade = (skipFadeIds?.has(s.id) ?? false) || isNewlyAdded

        const body = (
          <HoldPressable
            // undefined (not a no-op) for planned rows: HoldPressable only
            // runs the ramp when onLongPress is set, and a planned row
            // holding to select nothing shouldn't promise an action.
            onLongPress={s.is_planned ? undefined : () => onLongPress(s)}
            // No shrink: this row is flush edge-to-edge in the list, not a
            // standalone card, so scaling it down would pull its background
            // in from the sides and expose the card behind it.
            holdScale={1}
            // Matches the delay this row used before it had a ramp.
            holdDelay={250}
            onPress={() => {
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
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
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
                  <PrIcon variant="position" position={i + 1} historical={wasPosPr} />
                ) : null}
              </View>
              <IndexCol
                display={isSelected ? "✓" : i + 1}
                isPr={isPr}
                restLabel={
                  showRestTime && !s.is_planned ? restLabels[i] : null
                }
              />
              <Text
                style={[styles.setWeight, s.is_planned && styles.dimText]}
              >
                {isCardio
                  ? s.weight ?? "—"
                  : formatWeight(s.weight, unit)}{" "}
                <Text style={styles.setUnit}>{isCardio ? "min" : unit}</Text>
              </Text>
              <Text
                style={[styles.setReps, s.is_planned && styles.dimText]}
              >
                {isCardio ? `Lvl ${s.reps ?? "—"}` : s.reps ?? "—"}
              </Text>
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

            {!s.is_planned && !!s.note && (
              <View style={styles.setNoteLine}>
                <Ionicons
                  name="document-text-outline"
                  size={11}
                  color={theme.colors.muted}
                />
                <Text style={styles.setNoteText}>{s.note}</Text>
              </View>
            )}

          </HoldPressable>
        )

        // Swipe-to-delete only for logged sets (not planned targets, since
        // those have their own Hit/Skip flow above).
        if (s.is_planned)
          return (
            <SetRowFade key={s.id} leaving={leaving} skipFade={skipFade}>
              <View>{body}</View>
            </SetRowFade>
          )

        return (
          <SetRowFade key={s.id} leaving={leaving} skipFade={skipFade}>
          <Swipeable
            ref={(ref) => {
              swipeableRefs.current.set(s.id, ref)
            }}
            key={s.id}
            enabled={!selectionMode}
            // Native-driven animations so the row tracks the finger on the
            // UI thread. With JS driving, fast flicks outrun React's commit
            // cycle and the row stutters / progress never settles at 1
            // (so the action icons never fully fade in). Our renderRight-
            // Actions only animates translateX + opacity — both are
            // natively animatable, so there's no JS/native mixing on the
            // same node.
            useNativeAnimations={true}
            // OVERSHOOT PROFILE — the row tracks the finger 1:1 and
            // the release spring is allowed to overshoot the open/
            // closed target slightly before settling. Tuned together:
            //   - friction=1: 1:1 finger tracking
            //   - overshootFriction=6: dampens the rubber-band when
            //     dragging past the action width — without it, drag
            //     past 140px feels rubbery in a bad way
            //   - bounciness=8 + speed=14: snappy spring with a small
            //     natural bounce on settle (~250ms total). Stays in
            //     the bounciness/speed family — RN throws if a config
            //     mixes that with tension/friction or stiffness.
            //   - overshootClamping=false: lets the spring actually
            //     oscillate (this is the whole point of the overshoot
            //     profile — clamping=true would freeze it at target)
            friction={1.4}
            rightThreshold={10}
            dragOffsetFromRightEdge={5}
            activeOffsetX={[-5, 5]}
            failOffsetY={[-30, 30]}
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
              const current = swipeableRefs.current.get(s.id) ?? null
              if (openSwipeableRef.current === current) {
                openSwipeableRef.current = null
              }
            }}
            // "One-open-at-a-time" close, fired from three callbacks
            // so the old row closes as early as the legacy Swipeable
            // will let us. The ref-set in `onSwipeableWillOpen` is
            // critical — it tracks the row as "open" the moment its
            // open-spring starts, not when it settles. Without that,
            // a second swipe started during the first row's in-flight
            // open-spring sees a null ref and can't close it.
            //   - onSwipeableOpenStartDrag: drag begins on a closed
            //     row — earliest signal, runs the close in parallel
            //     with the new gesture
            //   - onSwipeableWillOpen: gesture committed past the
            //     threshold; spring is starting. Mark this row open
            //     NOW so it's closeable even mid-spring.
            //   - onSwipeableOpen: spring settled (fallback)
            onSwipeableOpenStartDrag={() => closeOtherOpenRow(s.id)}
            onSwipeableWillOpen={() => {
              closeOtherOpenRow(s.id)
              openSwipeableRef.current =
                swipeableRefs.current.get(s.id) ?? null
            }}
            onSwipeableOpen={() => {
              closeOtherOpenRow(s.id)
              openSwipeableRef.current =
                swipeableRefs.current.get(s.id) ?? null
            }}
            renderRightActions={(progress, dragX) => {
              // Three 36-wide circular buttons + 8px gaps + 8px padding
              // = 140 total reveal width. The buttons sit on a transparent
              // track so they read as row tools rather than three solid
              // stoplight blocks.
              const translateX = dragX.interpolate({
                inputRange: [-140, 0],
                outputRange: [0, 140],
                extrapolate: "clamp",
              })
              // Combine translateX + opacity on a single Animated.View
              // wrapping all three buttons. Going from 4 native-animated
              // layers (parent + 3 per-button) to 1 means the compositor
              // does one GPU operation per frame instead of four — the
              // single biggest source of swipe judder on Android, where
              // each Animated layer is a separate composition target.
              const groupOpacity = progress.interpolate({
                inputRange: [0, 0.05, 0.25, 1],
                outputRange: [0, 0, 1, 1],
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
      })}
      {showPlaceholder && pendingAdd && (() => {
        // Prefer the click-time PR prediction so the gold star renders on
        // the same frame as the placeholder. Once the real row arrives, use
        // its authoritative flags. The historical/silver variant is
        // intentionally skipped — silver means "this used to be a PR and
        // was beaten", which can't apply to a set being added right now.
        const newRow = pendingAdd.baseIds
          ? sets.find((s) => !pendingAdd.baseIds.has(s.id) && !s.is_planned)
          : null
        const phIsPr = newRow ? !!newRow.is_pr : pendingAdd.isPr
        const phIsPosPr = newRow
          ? !newRow.is_pr && !!newRow.is_position_pr
          : !pendingAdd.isPr && pendingAdd.isPosPr
        return (
        <SetRowFade key={`pending-${pendingAdd.key}`}>
          <Pressable style={styles.setRow} disabled>
            <View style={styles.setRowContent}>
              <View style={{ width: 28, alignItems: "flex-start" }}>
                {phIsPr ? (
                  <PrIcon />
                ) : showPositionPrs && phIsPosPr ? (
                  <PrIcon
                    variant="position"
                    position={pendingAdd.baseLen + 1}
                  />
                ) : null}
              </View>
              <View style={styles.setIndexCol}>
                <Text style={[styles.setIndex, phIsPr && { color: "#e0c050" }]}>
                  {pendingAdd.baseLen + 1}
                </Text>
              </View>
              <Text style={styles.setWeight}>
                {isCardio
                  ? pendingAdd.weight
                  : formatWeight(pendingAdd.weight, unit)}{" "}
                <Text style={styles.setUnit}>{isCardio ? "min" : unit}</Text>
              </Text>
              <Text style={styles.setReps}>
                {isCardio ? `Lvl ${pendingAdd.reps}` : pendingAdd.reps}
              </Text>
              {!isCardio && showOneRm && (
                <Text style={styles.oneRm}>
                  {formatWeight(
                    estimateOneRm(pendingAdd.weight, pendingAdd.reps),
                    unit
                  )}{" "}
                  1RM
                </Text>
              )}
            </View>
          </Pressable>
        </SetRowFade>
        )
      })()}
      {showTimeSinceLastSet && (() => {
        // Anchor the rest-timer to whichever is most recent: a pending-add
        // (user just clicked Save and the real row hasn't landed yet — its
        // `key` is Date.now() at click time), the last logged set on the
        // current exercise, or — if neither exists — the latest logged set
        // from any other exercise in this workout. The last fallback keeps
        // the ticker alive when the user switches exercises before logging
        // anything on the new one.
        let anchorMs: number | null = null
        if (pendingAdd) {
          anchorMs = pendingAdd.key
        } else {
          for (let i = sets.length - 1; i >= 0; i--) {
            const s = sets[i]
            if (s.is_planned) continue
            const parsed = Date.parse(s.created_at)
            if (Number.isFinite(parsed)) anchorMs = parsed
            break
          }
          if (anchorMs == null && prevWorkoutLastSetIso) {
            const parsed = Date.parse(prevWorkoutLastSetIso)
            if (Number.isFinite(parsed)) anchorMs = parsed
          }
        }
        if (anchorMs == null) return null
        return <TimeSinceLastSet anchorMs={anchorMs} />
      })()}
    </View>
  )
}

// Plain Animated.View overlay for editing a set's note. We stopped using
// react-native-modal here because its keyboard handling caused the modal
// to visibly track the keyboard for a frame on close. This is just an
// absolute-positioned card with a tap-to-dismiss backdrop and a single
// native-driven opacity animation — keyboard handling is whatever RN does
// for any focused TextInput in normal layout, no library quirks.
const NOTE_FADE_MS = 180
function NoteEditorSheet({
  visible,
  original,
  draft,
  onChangeDraft,
  onClose,
  onSave,
  title = "Note",
  placeholder = "Add a note for this set…",
  mode = "edit",
  onEdit,
}: {
  visible: boolean
  original: string
  draft: string
  onChangeDraft: (s: string) => void
  onClose: () => void
  onSave: () => void
  title?: string
  placeholder?: string
  /** "view" shows the saved note read-only behind a Close/Edit pair. Callers
   *  that have nothing to read — a set note, or an exercise with no note yet —
   *  leave this at "edit" and land straight in the input. */
  mode?: "view" | "edit"
  onEdit?: () => void
}) {
  const dirty = draft.trim() !== (original ?? "").trim()
  const inputRef = useRef<TextInput | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1,
        duration: NOTE_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: NOTE_FADE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, opacity])

  // Focus after one frame so the keyboard rises against an already visible
  // card (no focus-during-fade-in flash). Keyed on `mode` too, so tapping Edit
  // in a view-first sheet raises the keyboard the same way.
  useEffect(() => {
    if (!visible || mode !== "edit") return
    const f = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(f)
  }, [visible, mode])

  function handleSave() {
    if (!dirty) return
    // Close first; the snapshot mutation is deferred past the fade so the
    // set list behind doesn't re-render mid-animation when the new note
    // bubble appears.
    const save = onSave
    onClose()
    setTimeout(save, NOTE_FADE_MS + 40)
  }

  if (!mounted) return null

  const viewing = mode === "view"

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.noteOverlay, { opacity }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.noteOverlayCard} pointerEvents="box-none">
        <Text style={styles.noteOverlayTitle}>{title}</Text>
        {viewing ? (
          <ScrollView
            style={styles.noteViewScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.noteViewText}>{(original || draft).trim()}</Text>
          </ScrollView>
        ) : (
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.muted}
            multiline
            style={styles.noteSheetInput}
          />
        )}
        <View style={styles.noteSheetActions}>
          {viewing ? (
            <>
              <Button
                label="Close"
                variant="secondary"
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <Button label="Edit" onPress={onEdit} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <Button
                label="Save"
                onPress={handleSave}
                disabled={!dirty}
                style={{ flex: 1 }}
              />
            </>
          )}
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // Auto margin rather than space-between on the row, so the back chevron
  // keeps its own left position whatever else lands in the header.
  headerMenuBtn: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // Anchored under the header at the right edge, where the button is.
  // The dim is light: an iOS menu shades what is behind it, it does not
  // black it out.
  menuBackdrop: { backgroundColor: "rgba(0,0,0,0.25)" },
  menuCard: {
    position: "absolute",
    minWidth: 240,
    maxWidth: 300,
    backgroundColor: theme.colors.inputBg,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  // Label first, icon on the trailing edge — an iOS menu row, not the day
  // screen's icon-tile list.
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 12,
  },
  menuRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  menuRowPressed: { backgroundColor: "rgba(255,255,255,0.06)" },
  menuRowBody: { flex: 1, gap: 1 },
  menuRowText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  menuRowHint: { color: theme.colors.muted, fontSize: theme.fontSize.xs },
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
    backgroundColor: "rgba(255,255,255,0.02)",
    gap: theme.spacing[2],
  },
  // Stacked on top of the expanded body so both measure independently. Not in
  // flow, so the box's natural height is the expanded one.
  lastTimeCollapsedLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
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
  lastTimeAgo: {
    marginLeft: "auto",
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
  },
  lastTimeCalBtn: {
    width: 26,
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
    borderColor: "rgba(255,255,255,0.12)",
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
    borderColor: "rgba(255,255,255,0.12)",
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
    borderColor: "rgba(255,255,255,0.12)",
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
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    marginTop: theme.spacing[2],
    overflow: "hidden",
  },
  timeSinceLastSet: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
    paddingVertical: 6,
    paddingHorizontal: theme.spacing[3],
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
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
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // A plain fill across the row, in the same neutral grey the rest of the app
  // uses for raised surfaces. Reading it from the theme rather than a
  // hardcoded rgba keeps light mode working.
  setRowSelected: {
    backgroundColor: theme.colors.border,
  },
  setRowPlanned: {
    backgroundColor: "rgba(255,255,255,0.015)",
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
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
  setWeight: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "center" },
  setUnit: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
  setReps: { width: 50, color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "right" },
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
  noteOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 80,
    paddingHorizontal: theme.spacing[4],
    zIndex: 50,
    elevation: 50,
  },
  noteOverlayCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    // The card is what bounds a long note, and the scroll area shrinks inside
    // it. A maxHeight on the scroll area alone left the card free to grow.
    maxHeight: "70%",
  },
  noteOverlayTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  // Read-only body of the sheet. Keep in step with NoteSheet's viewer.
  noteViewScroll: { flexGrow: 0, flexShrink: 1 },
  noteViewText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
  },
  noteSheetInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    height: 96,
    maxHeight: 160,
    textAlignVertical: "top",
  },
  noteSheetActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
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
  // Sub-tab bar at the bottom of the SetLogger screen.
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
  // Keep in step with ExerciseDetailScreen's copy of this bar.
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
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  dayCardHeader: {
    padding: theme.spacing[3],
    backgroundColor: "rgba(255,255,255,0.10)",
    borderBottomColor: "rgba(255,255,255,0.18)",
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
    backgroundColor: "rgba(255,255,255,0.02)",
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
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  metricButtonPressed: {
    backgroundColor: "rgba(255,255,255,0.14)",
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
    borderColor: "rgba(255,255,255,0.12)",
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
  xAxisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  xAxisLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "600",
  },
  graphAxisLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "600",
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
    borderTopColor: "rgba(255,255,255,0.06)",
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
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(255,255,255,0.02)",
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: theme.colors.foreground,
    borderColor: theme.colors.foreground,
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
    borderBottomColor: "rgba(255,255,255,0.18)",
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
    borderColor: "rgba(255,255,255,0.05)",
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
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[5],
  },
  pickerCard: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "70%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  // A row inside pickerCard, which is a column. The title column takes the
  // flex here rather than on the card, where flex:1 would stretch the title
  // block and squash the set list under it.
  recordDayHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  pickerTitleCol: { flex: 1, gap: 2 },
  pickerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  pickerScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  pickerScrollContent: {
    gap: theme.spacing[1],
  },
  recordDaySets: {
    marginHorizontal: -theme.spacing[4],
  },
  setPickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.radius.md,
  },
  setPickerOptionActive: {
    backgroundColor: "rgba(0,119,188,0.12)",
  },
  setPickerOptionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  setPickerOptionCount: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
  },
  swipeDeleteText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: theme.fontSize.sm,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
})
