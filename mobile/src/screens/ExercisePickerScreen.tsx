import { useScreenSnapshot } from "../store/useScreenSnapshot"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  listExercisesQ,
} from "@lift/core"
import type { Exercise } from "@lift/core"
import { useActiveDate } from "../state/activeDate"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"
import { formatExerciseSubtitle } from "../format"
import { CategoryChips } from "../components/CategoryChips"
import { NewExerciseView } from "../components/NewExerciseView"
import { createPickerSelectionGuard } from "../navigation/workoutPickerGuard"
import { bindPickerInteraction } from "../navigation/pickerLifecycle"

type Mode = "pick" | "new"

/**
 * Picker rendered as a stack screen. Picking
 * an exercise calls `navigation.replace("SetLogger", ...)` so the user goes
 * straight to the logger as a single transition (no two-stage animation
 * where the modal slides down and then SetLogger pushes in).
 */
export function ExercisePickerScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>("pick")
  const activeDate = useActiveDate()
  const [selectionReady, setSelectionReady] = useState(false)
  const leaving = useRef(false)
  const selectionGuard = useRef(createPickerSelectionGuard()).current
  const interaction = useRef<ReturnType<typeof bindPickerInteraction> | null>(null)

  // Preloaded screens receive a new navigation object when they become active.
  // Rebind here, before paint, so the opening completion is observed.
  useLayoutEffect(() => {
    const controller = bindPickerInteraction(navigation, selectionGuard, setSelectionReady, {
      request: requestAnimationFrame,
      cancel: cancelAnimationFrame,
      now: () => performance.now(),
    })
    interaction.current = controller
    return () => {
      controller.dispose()
      interaction.current = null
    }
  }, [navigation, selectionGuard])

  useEffect(() => {
    interaction.current?.rearm()
  }, [mode])

  // Hand off the create-workout + add-exercise work to SetLogger itself.
  // Doing the mutations here would re-render every snapshot subscriber on
  // the JS thread BEFORE the navigation message reaches native, blocking the
  // push animation. Forwarding only `pendingCreate` keeps this handler a
  // no-op: native gets the nav command immediately, the push animation
  // starts. SetLogger creates the workout on the first set save. We pass
  // the exercise name + category too so SetLogger can
  // render its full UI shell from the very first frame, before the actual
  // workoutId/weId are resolved.
  function gotoLogger(ex: Exercise, touchStartedAt?: number) {
    if (leaving.current || !navigation.isFocused()) return
    selectionGuard.select(touchStartedAt, () => {
      leaving.current = true
      interaction.current?.block()
      navigation.replace("SetLogger", {
        pendingCreate: {
          date: activeDate,
          exerciseId: ex.id,
          exerciseName: ex.name,
          exerciseCategory: ex.category,
        },
      })
    })
  }

  function close() {
    if (leaving.current || !navigation.isFocused()) return
    leaving.current = true
    interaction.current?.block()
    navigation.goBack()
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      <View style={{ flex: 1 }}>
        {mode === "pick" ? (
          <PickView
            onClose={close}
            onPick={gotoLogger}
            onCreateNew={() => setMode("new")}
            selectionReady={selectionReady}
          />
        ) : (
          <NewExerciseView
            onBack={() => setMode("pick")}
            onCreated={(ex) => gotoLogger(ex)}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

function PickView({
  onClose,
  onPick,
  onCreateNew,
  selectionReady,
}: {
  onClose: () => void
  onPick: (ex: Exercise, touchStartedAt?: number) => void
  onCreateNew: () => void
  selectionReady: boolean
}) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const searchRef = useRef<TextInput>(null)
  const snapshot = useScreenSnapshot()
  const exercises = useMemo(
    () =>
      listExercisesQ({
        q: search || undefined,
        category: category ?? undefined,
        sort: "last_performed",
      }),
    [snapshot, search, category]
  )

  return (
    <Pressable style={{ flex: 1 }} onPress={() => Keyboard.dismiss()}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="close" size={28} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title}>Choose Exercise</Text>
        <Pressable onPress={onCreateNew} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="add" size={28} color={theme.colors.foreground} />
        </Pressable>
      </View>

      <Pressable
        style={styles.searchWrap}
        onPress={() => searchRef.current?.focus()}
      >
        <Ionicons name="search" size={18} color={theme.colors.muted} />
        <TextInput
          ref={searchRef}
          value={search}
          onChangeText={setSearch}
          placeholder="Exercise Name"
          placeholderTextColor={theme.colors.muted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Pressable>

      <CategoryChips
        selected={category}
        onSelect={(cat) => setCategory(category === cat ? null : cat)}
        padded
      />

      <FlatList
        data={exercises}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        extraData={selectionReady}
        renderItem={({ item }) => (
          <ExerciseRow
            ex={item}
            disabled={!selectionReady}
            onPress={(startedAt) => onPick(item, startedAt)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.muted, padding: theme.spacing[4] }}>
            No exercises match.
          </Text>
        }
      />
    </Pressable>
  )
}

function ExerciseRow({ ex, onPress, disabled }: {
  ex: Exercise
  onPress: (touchStartedAt?: number) => void
  disabled: boolean
}) {
  const touchStartedAt = useRef<number | undefined>(undefined)
  const { colors: catColors } = useCategoryStyles()
  const dotColor =
    catColors[ex.category] ?? theme.colors.cat[ex.category] ?? theme.colors.muted
  const subtitle = formatExerciseSubtitle(ex)
  return (
    <Pressable
      disabled={disabled}
      onPressIn={(event) => { touchStartedAt.current = event.nativeEvent.timestamp }}
      onPress={(event) => {
        // Accessibility activation may omit native touch data.
        const startedAt = event.nativeEvent.timestamp == null
          ? undefined
          : touchStartedAt.current ?? event.nativeEvent.timestamp
        touchStartedAt.current = undefined
        onPress(startedAt)
      }}
      style={({ pressed }) => [styles.row, pressedStyle(pressed)]}
    >
      <View style={[styles.rowDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{ex.name}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  headerSideBtn: { width: 32, alignItems: "center" },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.md, fontWeight: "700" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  search: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowDot: { width: 12, height: 12, borderRadius: 6 },
  rowName: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  rowSub: { color: theme.colors.muted, fontSize: theme.fontSize.sm, marginTop: 2 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[4],
  },
})
