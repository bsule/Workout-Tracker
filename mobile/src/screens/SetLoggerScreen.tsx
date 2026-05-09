import {
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
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  UIManager,
  View,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LineChart } from "react-native-gifted-charts"
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
import { PrIcon } from "../components/PrIcon"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

type SubTab = "workout" | "history" | "graph" | "records" | "settings"

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
type Metric = "one_rm" | "heaviest" | "avg_weight" | "volume"

const METRIC_OPTIONS: {
  id: Metric
  label: string
}[] = [
  { id: "one_rm", label: "Max 1RM" },
  { id: "heaviest", label: "Heaviest" },
  { id: "avg_weight", label: "Avg Weight" },
  { id: "volume", label: "Volume" },
]

export function SetLoggerScreen({ route, navigation }: any) {
  // The picker forwards `pendingCreate` instead of running the
  // create-workout + add-exercise mutations itself, so the navigation
  // message reaches native before any snapshot subscribers re-render.
  // We then defer the actual mutations behind InteractionManager — the
  // emit cascade (even with `freezeOnBlur` covering MainTabs) still costs
  // ~50–100ms of JS work, so running it inside `runAfterInteractions`
  // pushes it past the ~250ms native push animation. The screen slides in
  // at 60fps unobstructed, then the workoutId/weId resolve and the SetList
  // settles in. While unresolved we render a stub `we` synthesized from
  // the route params (exerciseName / exerciseCategory) so the slide-in
  // shows the populated header and form from the very first frame.
  const [resolved, setResolved] = useState<{
    workoutId: number
    weId: number
  } | null>(() => {
    const p = route.params
    if (p?.workoutId != null && p?.weId != null) {
      return { workoutId: p.workoutId, weId: p.weId }
    }
    return null
  })
  useEffect(() => {
    if (resolved) return
    const p = route.params
    if (!p?.pendingCreate) return
    const date: string = p.pendingCreate.date
    const exerciseId: number = p.pendingCreate.exerciseId
    const handle = InteractionManager.runAfterInteractions(() => {
      // batchMutations coalesces the create-workout + add-exercise pair
      // into a single index rebuild + subscriber emit.
      const ids = batchMutations(() => {
        const existing = getWorkoutByDateQ(date)
        const wid = existing?.id ?? createWorkout(date).row.id
        const we = addExerciseToWorkout(wid, exerciseId)
        return { workoutId: wid, weId: we.id }
      })
      setResolved(ids)
    })
    // Also cancel on `beforeRemove` so we don't commit the create-workout
    // mutation after the user has already chosen to leave — that would
    // strand a workout + empty WE in the snapshot (the existing
    // beforeRemove cleanup below sees workoutId=-1 and bails out).
    const unsub = navigation.addListener("beforeRemove", () => handle.cancel())
    return () => {
      handle.cancel()
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  const { showOneRm, showPositionPrs } = useSettings()
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

  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet
  const initialKg = seed?.weight ?? 0
  const initialReps = seed?.reps ?? 8

  const [weight, setWeight] = useState<number>(roundForDisplay(fromKg(initialKg, unit), unit))
  const [reps, setReps] = useState<number>(initialReps)
  const [error, setError] = useState<string | null>(null)
  // When non-null, Save updates this set instead of adding a new one. Set
  // by the row's swipe-Edit action.
  const [editingSetId, setEditingSetId] = useState<number | null>(null)
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
    // Dismiss the keyboard a frame before the modal slides out so the two
    // animations don't race — otherwise the modal slides down while the
    // keyboard lingers, exposing an empty band underneath.
    Keyboard.dismiss()
    setNoteEditingSet(null)
    setNoteDraft("")
  }
  function saveNote() {
    if (!noteEditingSet) return
    const id = noteEditingSet.id
    const note = noteDraft.trim()
    // Local store is synchronous, so close optimistically and animate the
    // row's note line in/out on the same render that the store updates.
    animateNext()
    closeNoteEditor()
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
    setError(null)
    setTab("workout")
  }

  function cancelEdit() {
    setEditingSetId(null)
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
    // While `resolved` is null we're still rendering the stub `we` from
    // pendingCreate — the real workoutId/weId haven't landed yet, so any
    // mutation would target id=-1. Saving is gated until the deferred
    // mutations resolve (typically <300ms, well before the user has time
    // to type weight/reps and tap Save).
    if (!resolved) return
    if (weight <= 0 || reps <= 0) {
      setError("Weight and reps must be greater than zero.")
      return
    }
    try {
      if (editingSetId != null) {
        // Flip the form back to add-mode FIRST so the editAnim effect kicks
        // off the border-color/scale transition. Defer the actual mutation
        // by one frame so the store update (which forces a full SetList
        // re-render and PR recompute) doesn't happen on the same frame
        // as the form transition.
        const w = toKg(weight, unit)
        const r = reps
        const id = editingSetId
        setEditingSetId(null)
        requestAnimationFrame(() => {
          api.updateSet(id, { weight: w, reps: r })
        })
      } else if (isPlanned) {
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
          requestAnimationFrame(() => {
            api.addSet(weId, { weight: w, reps: r })
          })
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to save set")
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
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
        {tab === "workout" && !selectionMode && (
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
            />
            <NumericField
              label="Reps"
              value={reps}
              step={1}
              min={0}
              onChange={setReps}
            />
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

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={styles.listScrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {tab === "workout" && firstPaintDone && (
          <>
            <SetList
              sets={sets}
              unit={unit}
              canHit={!isPlanned}
              showOneRm={showOneRm}
              showPositionPrs={showPositionPrs}
              selectedIds={selectedIds}
              pendingAdd={pendingAdd}
              leavingIds={leavingIds}
              skipFadeIds={skipFadeIds}
              onLongPress={(s) => {
                if (s.is_planned) return
                if (!selectedIds.includes(s.id)) toggleSelected(s.id)
              }}
              onSelectToggle={toggleSelected}
              onHit={(s) => {
                if (s.weight == null || s.reps == null) return
                logPlannedSet(s.id, { weight: s.weight, reps: s.reps })
              }}
              onEdit={startEdit}
              onAddNote={openNoteEditor}
              onDelete={(s) => startDelete(s.id)}
            />
          </>
        )}
        {tab === "history" && (
          <PastHistory
            days={history}
            currentDate={workout.date}
            unit={unit}
            showOneRm={showOneRm}
            showPositionPrs={showPositionPrs}
          />
        )}
        {tab === "graph" && <GraphPanel days={history} unit={unit} />}
        {tab === "records" && <RecordsPanel days={history} unit={unit} />}
        {tab === "settings" && <SettingsPanel navigation={navigation} />}
      </ScrollView>

      <SubTabBar tab={tab} onChange={setTab} />
      {/* Gated on firstPaintDone so the Modal's host-view allocation isn't on
       *  the critical path of the slide-in. The Modal is invisible during the
       *  push animation anyway; mounting it one frame later is imperceptible. */}
      {firstPaintDone && (
        <NoteEditorSheet
          visible={noteEditingSet != null}
          original={noteEditingSet?.note ?? ""}
          draft={noteDraft}
          onChangeDraft={setNoteDraft}
          onCancel={closeNoteEditor}
          onSave={saveNote}
        />
      )}
    </StaticSafeAreaView>
    </TouchableWithoutFeedback>
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

export function PastHistory({
  days,
  currentDate,
  unit,
  showOneRm,
  showPositionPrs,
}: {
  days: ExerciseHistoryDay[]
  currentDate: string
  unit: "kg" | "lb"
  showOneRm: boolean
  showPositionPrs: boolean
}) {
  const past = days.filter((d) => d.date <= currentDate)
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
        <View key={day.date} style={styles.dayCard}>
          <Text style={styles.dayDate}>{niceDate(day.date)}</Text>
          {day.sets.map((s, i) => (
            <View key={s.id} style={styles.pastSetRow}>
              <View style={{ width: 28, alignItems: "flex-start" }}>
                {s.is_pr || s.was_pr ? (
                  <PrIcon historical={!s.is_pr && s.was_pr} />
                ) : showPositionPrs && (s.is_position_pr || s.was_position_pr) ? (
                  <PrIcon
                    variant="position"
                    position={i + 1}
                    historical={!s.is_position_pr && s.was_position_pr}
                  />
                ) : null}
              </View>
              <Text style={styles.setIndex}>{i + 1}</Text>
              <Text style={styles.setWeight}>
                {formatWeight(s.weight, unit)}{" "}
                <Text style={styles.setUnit}>{unit}</Text>
              </Text>
              <Text style={styles.setReps}>{s.reps ?? "—"}</Text>
              {showOneRm && (
                <Text style={styles.oneRm}>
                  {formatWeight(s.estimated_one_rm, unit)} 1RM
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

function dayValueKg(day: ExerciseHistoryDay, metric: Metric): number {
  const sets = day.sets.filter(
    (s): s is typeof s & { weight: number; reps: number } =>
      s.weight != null && s.reps != null
  )
  if (!sets.length) return 0
  switch (metric) {
    case "one_rm":
      return sets.reduce(
        (m, s) => (s.estimated_one_rm > m ? s.estimated_one_rm : m),
        0
      )
    case "heaviest":
      return sets.reduce((m, s) => (s.weight > m ? s.weight : m), 0)
    case "avg_weight":
      return sets.reduce((sum, s) => sum + s.weight, 0) / sets.length
    case "volume":
      return sets.reduce((sum, s) => sum + s.weight * s.reps, 0)
  }
}

export function GraphPanel({ days, unit }: { days: ExerciseHistoryDay[]; unit: "kg" | "lb" }) {
  const [metric, setMetric] = useState<Metric>("one_rm")
  const points = useMemo(
    () =>
      days
        .map((d) => ({
          date: d.date,
          value: roundForDisplay(fromKg(dayValueKg(d, metric), unit), unit),
        }))
        .filter((p) => p.value > 0)
        .sort(
          (a, b) =>
            new Date(a.date + "T00:00:00").getTime() -
            new Date(b.date + "T00:00:00").getTime()
        ),
    [days, metric, unit]
  )

  const opt = METRIC_OPTIONS.find((m) => m.id === metric)!

  if (points.length === 0) {
    return (
      <View style={styles.graphWrap}>
        <MetricSwitcher metric={metric} onChange={setMetric} />
        <View style={[styles.empty, { marginTop: theme.spacing[2] }]}>
          <Text style={styles.emptyText}>No data yet. Log a few sets and the chart will fill in.</Text>
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
  const screenWidth = Dimensions.get("window").width
  const chartWidth = Math.max(screenWidth - theme.spacing[8], points.length * 58)
  const chartData = points.map((p, i) => ({
    value: p.value,
    label: xLabelForPoint(p.date, i, points.length),
    date: p.date,
    labelTextStyle: {
      color: theme.colors.muted,
      fontSize: 10,
      fontWeight: "600" as const,
    },
    dataPointColor: p.value === peak ? theme.colors.secondary : theme.colors.primary,
    dataPointRadius: p.value === peak ? 4 : 3,
  }))

  return (
    <View style={styles.graphWrap}>
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartEyebrow}>{opt.label}</Text>
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

        <LineChart
          areaChart
          curved
          data={chartData}
          width={chartWidth}
          height={220}
          spacing={58}
          initialSpacing={18}
          endSpacing={18}
          thickness={2}
          color={theme.colors.primary}
          startFillColor={theme.colors.primary}
          endFillColor={theme.colors.primary}
          startOpacity={0.32}
          endOpacity={0.02}
          noOfSections={4}
          yAxisColor="transparent"
          xAxisColor="rgba(255,255,255,0.10)"
          rulesColor="rgba(255,255,255,0.06)"
          rulesType="solid"
          yAxisTextStyle={{
            color: theme.colors.muted,
            fontSize: 10,
            fontWeight: "600",
          }}
          hideDataPoints={false}
          dataPointsColor={theme.colors.primary}
          dataPointsRadius={3}
          xAxisLabelsVerticalShift={4}
          yAxisLabelWidth={42}
          adjustToWidth={points.length <= 5}
          scrollToEnd={points.length > 5}
          pointerConfig={{
            pointerStripColor: "rgba(255,255,255,0.22)",
            pointerStripWidth: 1,
            pointerColor: theme.colors.foreground,
            radius: 5,
            activatePointersInstantlyOnTouch: true,
            persistPointer: true,
            pointerLabelWidth: 110,
            pointerLabelHeight: 48,
            pointerLabelComponent: (items: any[]) => {
              const item = items?.[0]
              if (!item) return null
              return (
                <View style={styles.pointerLabel}>
                  <Text style={styles.pointerValue}>
                    {fmtMetric(item.value, metric)} {unit}
                  </Text>
                  <Text style={styles.pointerDate}>{niceDate(item.date)}</Text>
                </View>
              )
            },
          }}
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
      </View>
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

function fmtMetric(value: number, metric: Metric): string {
  if (metric === "volume") return value.toFixed(0)
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function xLabelForPoint(date: string, index: number, count: number): string {
  if (count === 1 || index === 0 || index === count - 1 || index === Math.floor(count / 2)) {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  }
  return ""
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

export function RecordsPanel({
  days,
  unit,
}: {
  days: ExerciseHistoryDay[]
  unit: "kg" | "lb"
}) {
  // Compute records across all logged (non-planned) sets in history.
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
    </View>
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

function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
}) {
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
          value={String(value)}
          onChangeText={(t) => {
            const n = Number(t.replace(/[^0-9.\-]/g, ""))
            onChange(Number.isFinite(n) ? n : 0)
          }}
          keyboardType="numeric"
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
  canHit,
  showOneRm,
  showPositionPrs,
  selectedIds,
  pendingAdd,
  leavingIds,
  skipFadeIds,
  onLongPress,
  onSelectToggle,
  onHit,
  onEdit,
  onAddNote,
  onDelete,
}: {
  sets: WorkoutSet[]
  unit: "kg" | "lb"
  canHit: boolean
  showOneRm: boolean
  showPositionPrs: boolean
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
  onHit: (s: WorkoutSet) => void
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
  // Compute the heaviest 1RM among logged sets so we can subtly highlight
  // the row whose effort was the strongest of the session.
  const sessionTopOneRm = sets.reduce(
    (m, s) =>
      !s.is_planned ? Math.max(m, estimateOneRm(s.weight, s.reps)) : m,
    0
  )

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
        const isTopOfSession =
          !s.is_planned && oneRm > 0 && oneRm === sessionTopOneRm
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
              if (selectionMode && !s.is_planned) onSelectToggle(s.id)
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
                ) : !s.is_planned && isTopOfSession ? (
                  <View style={styles.topDot} />
                ) : null}
              </View>
              <Text
                style={[
                  styles.setIndex,
                  isPr && { color: "#e0c050" },
                ]}
              >
                {isSelected ? "✓" : i + 1}
              </Text>
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

            {canHit && s.is_planned && (
              <View style={styles.plannedActionsRow}>
                <Pressable
                  onPress={() => onHit(s)}
                  style={({ pressed }) => [
                    styles.hitBtn,
                    pressed && styles.actionPressed,
                  ]}
                >
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={theme.colors.secondary}
                  />
                  <Text style={styles.hitBtnText}>Hit</Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(s)}
                  style={({ pressed }) => [
                    styles.skipBtn,
                    pressed && styles.actionPressed,
                  ]}
                >
                  <Text style={styles.skipBtnText}>Skip</Text>
                </Pressable>
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
              <Text style={styles.setIndex}>{pendingAdd.baseLen + 1}</Text>
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

// Fixed centered popup for editing a set's note. No slide/fade animation —
// the Modal opens and closes instantly so re-opens feel snappy. Save is
// disabled when the trimmed draft equals the original (no-op).
function NoteEditorSheet({
  visible,
  original,
  draft,
  onChangeDraft,
  onCancel,
  onSave,
}: {
  visible: boolean
  original: string
  draft: string
  onChangeDraft: (s: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  const dirty = draft.trim() !== (original ?? "").trim()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.notePopupRoot}
      >
        <Pressable style={styles.notePopupBackdrop} onPress={onCancel}>
          {/* Stop the inner card from forwarding presses to the backdrop. */}
          <Pressable onPress={() => {}} style={styles.notePopupCard}>
            <Text style={styles.noteSheetTitle}>Note</Text>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Add a note for this set…"
              placeholderTextColor={theme.colors.muted}
              multiline
              autoFocus
              style={styles.noteSheetInput}
            />
            <View style={styles.noteSheetActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onCancel}
                style={{ flex: 1 }}
              />
              <Button
                label="Save"
                onPress={onSave}
                disabled={!dirty}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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
  topDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  plannedActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    marginLeft: 40,
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
  setWeight: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "center" },
  setUnit: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
  setReps: { width: 50, color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "700", textAlign: "right" },
  hitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(62,230,192,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(62,230,192,0.35)",
  },
  hitBtnText: { color: theme.colors.secondary, fontWeight: "700", fontSize: theme.fontSize.xs },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  skipBtnText: { color: theme.colors.muted, fontWeight: "700", fontSize: theme.fontSize.xs },
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
  notePopupRoot: {
    flex: 1,
  },
  notePopupBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[10],
  },
  notePopupCard: {
    width: "90%",
    maxWidth: 360,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  noteSheetTitle: {
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
  actionPressed: { opacity: 0.78 },
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
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[3],
    gap: 4,
  },
  dayDate: { color: theme.colors.foreground, fontWeight: "700", fontSize: theme.fontSize.sm },
  pastSetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: 4,
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
    overflow: "hidden",
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
  swipeDeleteText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: theme.fontSize.sm,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
})
