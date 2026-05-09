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
  LayoutAnimation,
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
  createWorkout,
  defaultStep,
  deleteWorkout,
  estimateOneRm,
  formatWeight,
  fromKg,
  getExerciseHistoryQ,
  getWorkoutByDateQ,
  getWorkoutQ,
  localApi as api,
  logPlannedSet,
  roundForDisplay,
  toKg,
  useStore,
} from "@lift/core"
import type {
  ExerciseHistoryDay,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "@lift/core"
import { Button } from "../components/Button"
import { PopupModal } from "../components/PopupModal"
import { PrIcon } from "../components/PrIcon"
import { SetList as SharedSetList } from "../components/SetList"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

type SubTab = "workout" | "history" | "graph" | "records" | "settings"

function formatRest(prevIso: string | null | undefined, curIso: string): string | null {
  if (!prevIso) return null
  const diff = (Date.parse(curIso) - Date.parse(prevIso)) / 1000
  if (!Number.isFinite(diff) || diff <= 30) return null
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

const EMPTY_HISTORY: ExerciseHistoryDay[] = []

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
  const { showOneRm, showPositionPrs, showRestTime } = useSettings()
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
  // Lazy: only run the history query when a tab that needs it is active.
  // The query iterates indexes and is fast, but it runs inside the same
  // synchronous React commit triggered by add/delete-set mutations, where
  // every saved millisecond delays the new row's fade-in start.
  const needsHistory =
    tab === "history" || tab === "graph" || tab === "records"
  const history: ExerciseHistoryDay[] = useMemo(() => {
    if (exerciseId == null || !needsHistory) return EMPTY_HISTORY
    return getExerciseHistoryQ(exerciseId)
  }, [snapshot, exerciseId, needsHistory])

  const prevWorkoutLastSetIso = useMemo<string | null>(() => {
    if (!showRestTime || !workout || we == null) return null
    let latest: string | null = null
    for (const otherWe of workout.exercises) {
      if (otherWe.id === we.id) continue
      for (const s of otherWe.sets) {
        if (s.is_planned) continue
        if (latest === null || Date.parse(s.created_at) > Date.parse(latest)) {
          latest = s.created_at
        }
      }
    }
    return latest
  }, [workout, we, showRestTime])

  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet
  const initialKg = seed?.weight ?? 0
  const initialReps = seed?.reps ?? 8

  const [weight, setWeight] = useState<number>(roundForDisplay(fromKg(initialKg, unit), unit))
  const [reps, setReps] = useState<number>(initialReps)
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
  const [pendingAdd, setPendingAdd] = useState<{
    weight: number
    reps: number
    key: number
    baseLen: number
    baseIds: Set<number>
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
      if (!currentWe || currentWe.sets.length > 0) return
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
  function startDelete(id: number) {
    setLeavingIds((prev) => {
      const n = new Set(prev)
      n.add(id)
      return n
    })
    // 180ms matches the SetRowFade leaving fade so the LayoutAnimation
    // collapse fires the moment the row reaches opacity 0 — not earlier
    // (would visibly cut a half-faded row) and not noticeably later.
    setTimeout(() => {
      animateNext()
      api.deleteSet(id)
      setLeavingIds((prev) => {
        if (!prev.has(id)) return prev
        const n = new Set(prev)
        n.delete(id)
        return n
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
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [editingSetId, editAnim])

  function startEdit(s: WorkoutSet) {
    // No layout animation: the form layout no longer changes when entering
    // edit mode (only colors/labels flip). Wrapping in LayoutAnimation made
    // every set row in the list animate too, which felt like a freeze.
    setEditingSetId(s.id)
    setWeight(roundForDisplay(fromKg(s.weight ?? 0, unit), unit))
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

  function toggleSelected(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
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
            for (const id of ids) startDelete(id)
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
    setError(null)
    if (reps <= 0) {
      setError("Add at least 1 rep to log this set.")
      return
    }
    if (weight < 0) {
      setError("Weight can’t be negative.")
      return
    }
    try {
      if (editingSetId != null) {
        // Editing requires `resolved` (you can't edit a set that doesn't
        // exist yet). Bail otherwise.
        if (!resolved) return
        // Flip the form back to add-mode FIRST so the editAnim effect kicks
        // off the border-color/scale transition. Defer the actual mutation
        // by one frame so the store update (which forces a full SetList
        // re-render and PR recompute) doesn't happen on the same frame
        // as the form transition.
        const w = toKg(weight, unit)
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
        requestAnimationFrame(() => {
          if (editingPlanned) {
            logPlannedSet(id, { weight: w, reps: r })
          } else {
            api.updateSet(id, {
              weight: w,
              reps: r,
              ...(newCreatedAt ? { created_at: newCreatedAt } : {}),
            })
          }
        })
      } else if (isPlanned) {
        // isPlanned only true for an existing planned workout — already resolved.
        if (!resolved) return
        // Same optimistic-placeholder flow for planned-set authoring so the
        // fade starts on click instead of after the mutation commits.
        const w = toKg(weight, unit)
        const r = reps
        setPendingAdd({
          weight: w,
          reps: r,
          key: Date.now(),
          baseLen: sets.length,
          baseIds: new Set(sets.map((s) => s.id)),
        })
        requestAnimationFrame(() => {
          api.addPlannedSet(weId, { weight: w, reps: r })
        })
      } else {
        const queued = sets.find((s) => s.is_planned)
        if (queued) {
          // Logging against a planned set: same row, fade weight/reps update
          // would be jarring — skip animation.
          logPlannedSet(queued.id, { weight: toKg(weight, unit), reps })
        } else {
          // Optimistic placeholder: render an immediate fading-in row so the
          // user sees the row on the same frame as the click, then defer the
          // store mutation to the next frame so the heavy commit doesn't
          // block the fade from starting.
          const w = toKg(weight, unit)
          const r = reps
          setPendingAdd({
            weight: w,
            reps: r,
            key: Date.now(),
            baseLen: sets.length,
            baseIds: new Set(sets.map((s) => s.id)),
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
          requestAnimationFrame(() => {
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
            setResolved(ids)
            api.addSet(ids.weId, { weight: w, reps: r })
          })
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
      </View>
      {/* Fixed header + form so the layout doesn't reflow when sets are added. */}
      <View style={styles.fixedTop}>
        <View style={styles.titleWrap}>
          <Text style={styles.exerciseName}>{we.exercise.name}</Text>
          <Text style={styles.exerciseMeta}>{we.exercise.category}</Text>
        </View>

        {tab === "workout" && selectionMode && (
          <View style={[styles.card, styles.selectionBar]}>
            <Text style={styles.selectionCount}>
              {selectedIds.length} selected
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button
                label="Delete"
                variant="destructive"
                onPress={confirmDeleteSelected}
                style={{ flex: 1 }}
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={clearSelection}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
        {tab === "workout" && !selectionMode && !firstPaintDone && (
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
        {tab === "workout" && !selectionMode && firstPaintDone && (
          <Animated.View
            style={[
              styles.card,
              {
                transform: [
                  {
                    // 3-point interpolation gives a subtle scale dip at the
                    // midpoint of every transition (entering or exiting
                    // edit) — built-in tactile feedback without a separate
                    // sequence/spring fighting the main timing.
                    scale: editAnim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 0.985, 1],
                    }),
                  },
                ],
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
              label={editingSetId != null ? "Weight (editing)" : "Weight"}
              unit={unit}
              value={weight}
              step={step}
              min={0}
              onChange={setWeight}
              allowDecimal
            />
            <NumericField
              label="Reps"
              value={reps}
              step={1}
              min={0}
              onChange={setReps}
            />
            {editingSetId != null && showRestTime && editingRestAnchorIso != null && (
              <NumericField
                label="Rest (sec)"
                value={restSec}
                step={5}
                min={0}
                onChange={setRestSec}
              />
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
        )}
      </View>

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
              showOneRm={showOneRm}
              showPositionPrs={showPositionPrs}
              showRestTime={showRestTime}
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
          {tab === "graph" && <GraphPanel days={history} unit={unit} />}
          {tab === "records" && <RecordsPanel days={history} unit={unit} />}
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
      <PlannedSetActionsModal
        set={activePlannedSet}
        unit={unit}
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
  onClose,
  onHit,
  onNotHit,
  onDelete,
}: {
  set: WorkoutSet | null
  unit: "kg" | "lb"
  onClose: () => void
  onHit: (s: WorkoutSet) => void
  onNotHit: (s: WorkoutSet) => void
  onDelete: (s: WorkoutSet) => void
}) {
  const title =
    set != null
      ? `${formatWeight(set.weight ?? undefined, unit)} ${unit} × ${set.reps ?? "—"}`
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
    { key: "records", label: "Records", icon: "trophy-outline" },
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
        <Text style={styles.dayDate}>{niceDate(day.date)}</Text>
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
      <SharedSetList sets={day.sets} />
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
      <View style={[styles.empty, { marginTop: theme.spacing[2] }]}>
        <Text style={styles.emptyText}>No past workouts for this exercise yet.</Text>
      </View>
    )
  }
  return (
    <View style={{ paddingVertical: theme.spacing[3], gap: theme.spacing[3] }}>
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
      <View style={[styles.empty, { marginTop: theme.spacing[2] }]}>
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
    return (
      <View style={styles.graphWrap}>
        <MetricSwitcher metric={metric} onChange={setMetric} />
        {metric === "per_set" && (
          <SetIndexSwitcher setIndex={setIndex} onChange={setSetIndex} />
        )}
        <View style={[styles.empty, { marginTop: theme.spacing[2] }]}>
          <Text style={styles.emptyText}>
            {metric === "per_set"
              ? `No ${SET_INDEX_OPTIONS.find((s) => s.value === setIndex)!.label} sets logged yet.`
              : "No data yet. Log a few sets and the chart will fill in."}
          </Text>
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
                    r={isActive ? 5 : isPeak ? 4 : 3}
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
    <View style={{ paddingVertical: theme.spacing[3], gap: theme.spacing[3] }}>
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

interface RecordCard {
  label: string
  value: string
  sub?: string
  icon: keyof typeof Ionicons.glyphMap
  color: string
}

// Distinct hues per record so the page reads at a glance. These are the
// brightened category palette tones, repurposed.
const RECORD_COLORS = {
  oneRm: "#facc15",      // yellow — 1RM "trophy"
  heaviest: "#ef4444",   // red — peak weight
  reps: "#22d3ee",       // cyan — endurance
  setVolume: "#ec4899",  // pink/magenta — single-set volume
  sessionVolume: "#8b5cf6", // violet — total session
} as const

export const RecordsPanel = memo(function RecordsPanel({
  days,
  unit,
}: {
  days: ExerciseHistoryDay[]
  unit: "kg" | "lb"
}) {
  const records = useMemo<RecordCard[]>(() => {
    let bestOneRmKg = 0
    let bestOneRmReps = 0
    let bestOneRmSetWeight = 0
    let heaviestKg = 0
    let heaviestReps = 0
    let bestSetVolumeKg = 0
    let bestSetVolumeReps = 0
    let bestSetVolumeWeight = 0
    let bestSessionVolumeKg = 0
    let bestSessionDate: string | null = null

    for (const day of days) {
      let sessionVolume = 0
      for (const s of day.sets) {
        if (s.weight == null || s.reps == null) continue
        if (s.estimated_one_rm > bestOneRmKg) {
          bestOneRmKg = s.estimated_one_rm
          bestOneRmReps = s.reps
          bestOneRmSetWeight = s.weight
        }
        if (s.weight > heaviestKg) {
          heaviestKg = s.weight
          heaviestReps = s.reps
        }
        const setVol = s.weight * s.reps
        if (setVol > bestSetVolumeKg) {
          bestSetVolumeKg = setVol
          bestSetVolumeWeight = s.weight
          bestSetVolumeReps = s.reps
        }
        sessionVolume += setVol
      }
      if (sessionVolume > bestSessionVolumeKg) {
        bestSessionVolumeKg = sessionVolume
        bestSessionDate = day.date
      }
    }

    if (bestOneRmKg === 0) return []

    return [
      {
        label: "Best 1RM (estimated)",
        value: `${formatWeight(bestOneRmKg, unit)} ${unit}`,
        sub: `from ${formatWeight(bestOneRmSetWeight, unit)} ${unit} × ${bestOneRmReps}`,
        icon: "trophy",
        color: RECORD_COLORS.oneRm,
      },
      {
        label: "Heaviest set",
        value: `${formatWeight(heaviestKg, unit)} ${unit}`,
        sub: `× ${heaviestReps} reps`,
        icon: "barbell",
        color: RECORD_COLORS.heaviest,
      },
      {
        label: "Best set volume",
        value: `${formatWeight(bestSetVolumeKg, unit)} ${unit}`,
        sub: `${formatWeight(bestSetVolumeWeight, unit)} × ${bestSetVolumeReps}`,
        icon: "flash",
        color: RECORD_COLORS.setVolume,
      },
      {
        label: "Best session volume",
        value: `${formatWeight(bestSessionVolumeKg, unit)} ${unit}`,
        sub: bestSessionDate ? niceDate(bestSessionDate) : undefined,
        icon: "flame",
        color: RECORD_COLORS.sessionVolume,
      },
    ]
  }, [days, unit])

  // Best weight at each exact rep count 1..15. A row is "dominated" if some
  // higher rep count has weight >= this row's weight (strictly better lift).
  const repRecords = useMemo(() => {
    const bestByReps = new Map<number, number>()
    for (const day of days) {
      for (const s of day.sets) {
        if (s.weight == null || s.reps == null) continue
        if (s.reps < 1 || s.reps > 15) continue
        const cur = bestByReps.get(s.reps) ?? 0
        if (s.weight > cur) bestByReps.set(s.reps, s.weight)
      }
    }
    const rows: { reps: number; weightKg: number | null; dominated: boolean }[] = []
    for (let r = 1; r <= 15; r++) {
      const w = bestByReps.get(r) ?? null
      let dominated = false
      if (w != null) {
        for (let r2 = r + 1; r2 <= 15; r2++) {
          const w2 = bestByReps.get(r2)
          if (w2 != null && w2 >= w) {
            dominated = true
            break
          }
        }
      }
      rows.push({ reps: r, weightKg: w, dominated })
    }
    return rows
  }, [days])

  if (records.length === 0) {
    return (
      <View style={[styles.empty, { marginTop: theme.spacing[3] }]}>
        <Text style={styles.emptyText}>
          No records yet. Log a few sets to see your bests here.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ paddingVertical: theme.spacing[3], gap: theme.spacing[3] }}>
      <Text style={styles.section}>Personal records</Text>
      {records.map((r) => (
        <View
          key={r.label}
          style={[
            styles.recordCard,
            {
              borderLeftColor: r.color,
              borderLeftWidth: 4,
            },
          ]}
        >
          <View
            style={[
              styles.recordIconCircle,
              { backgroundColor: r.color + "26" },
            ]}
          >
            <Ionicons name={r.icon} size={20} color={r.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.recordLabel}>{r.label}</Text>
            <View style={styles.recordValueRow}>
              <Text style={[styles.recordValue, { color: r.color }]}>
                {r.value}
              </Text>
            </View>
            {r.sub && <Text style={styles.recordSub}>{r.sub}</Text>}
          </View>
        </View>
      ))}

      <Text style={[styles.section, { marginTop: theme.spacing[2] }]}>
        Best by reps
      </Text>
      <View style={styles.repPrTable}>
        {repRecords.map((row, i) => {
          const muted = row.weightKg == null || row.dominated
          return (
            <View
              key={row.reps}
              style={[
                styles.repPrRow,
                i < repRecords.length - 1 && styles.repPrRowDivider,
                muted && styles.repPrRowMuted,
              ]}
            >
              <Text style={[styles.repPrReps, muted && styles.repPrTextMuted]}>
                {row.reps} {row.reps === 1 ? "rep" : "reps"}
              </Text>
              <Text style={[styles.repPrWeight, muted && styles.repPrTextMuted]}>
                {row.weightKg != null
                  ? `${formatWeight(row.weightKg, unit)} ${unit}`
                  : "—"}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
})

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
  showOneRm,
  showPositionPrs,
  showRestTime,
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
  showOneRm: boolean
  showPositionPrs: boolean
  showRestTime: boolean
  prevWorkoutLastSetIso: string | null
  selectedIds: number[]
  pendingAdd: {
    weight: number
    reps: number
    key: number
    baseLen: number
    baseIds: Set<number>
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
    return (
      <View style={[styles.card, { borderStyle: "dashed", alignItems: "center" }]}>
        <Text style={{ color: theme.colors.muted, fontSize: theme.fontSize.sm }}>
          No sets logged yet. Log your first set above.
        </Text>
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
          <Pressable
            onLongPress={() => onLongPress(s)}
            onPress={() => {
              if (s.is_planned) {
                onPlannedTap(s)
                return
              }
              if (selectionMode) onSelectToggle(s.id)
            }}
            delayLongPress={350}
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
                {formatWeight(s.weight, unit)}{" "}
                <Text style={styles.setUnit}>{unit}</Text>
              </Text>
              <Text
                style={[styles.setReps, s.is_planned && styles.dimText]}
              >
                {s.reps ?? "—"}
              </Text>
              {!s.is_planned && showOneRm && oneRm > 0 ? (
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

          </Pressable>
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
                      name="create-outline"
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
      {showPlaceholder && pendingAdd && (
        <SetRowFade key={`pending-${pendingAdd.key}`}>
          <Pressable style={styles.setRow} disabled>
            <View style={styles.setRowContent}>
              <View style={{ width: 28, alignItems: "flex-start" }} />
              <View style={styles.setIndexCol}>
                <Text style={styles.setIndex}>{pendingAdd.baseLen + 1}</Text>
              </View>
              <Text style={styles.setWeight}>
                {formatWeight(pendingAdd.weight, unit)}{" "}
                <Text style={styles.setUnit}>{unit}</Text>
              </Text>
              <Text style={styles.setReps}>{pendingAdd.reps}</Text>
              {showOneRm && (
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
      )}
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
}: {
  visible: boolean
  original: string
  draft: string
  onChangeDraft: (s: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const dirty = draft.trim() !== (original ?? "").trim()
  const inputRef = useRef<TextInput | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      // Focus after one frame so the keyboard rises against an already
      // visible card (no focus-during-fade-in flash).
      const f = requestAnimationFrame(() => inputRef.current?.focus())
      Animated.timing(opacity, {
        toValue: 1,
        duration: NOTE_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return () => cancelAnimationFrame(f)
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

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.noteOverlay, { opacity }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.noteOverlayCard} pointerEvents="box-none">
        <Text style={styles.noteOverlayTitle}>Note</Text>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder="Add a note for this set…"
          placeholderTextColor={theme.colors.muted}
          multiline
          style={styles.noteSheetInput}
        />
        <View style={styles.noteSheetActions}>
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
  fixedTop: { padding: theme.spacing[4], gap: theme.spacing[4] },
  contentScroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listScrollContent: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[8] },
  titleWrap: { gap: 4 },
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
  setRowSelected: {
    backgroundColor: "rgba(0,119,188,0.10)",
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
    ...StyleSheet.absoluteFillObject,
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
  },
  noteOverlayTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
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
    gap: theme.spacing[3],
  },
  selectionCount: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  // Sub-tab bar at the bottom of the SetLogger screen.
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
    borderRadius: theme.radius.md,
    paddingVertical: 4,
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
    paddingVertical: theme.spacing[3],
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
  chartCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
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
  // Records cards
  recordCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.card,
    borderColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
  },
  recordIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  recordLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  recordValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginTop: 2,
  },
  recordValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  recordSub: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  repPrTable: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    overflow: "hidden",
  },
  repPrRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  repPrRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  repPrRowMuted: {
    opacity: 0.4,
  },
  repPrReps: {
    width: 72,
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  repPrWeight: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  repPrTextMuted: {
    color: theme.colors.muted,
  },
  swipeDeleteText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: theme.fontSize.sm,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
})
