import { useScreenSnapshot } from "../store/useScreenSnapshot"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  InteractionManager,
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

type Mode = "pick" | "new"

/**
 * Picker rendered as a stack screen with `presentation: "modal"`. Picking
 * an exercise calls `navigation.replace("SetLogger", ...)` so the user goes
 * straight to the logger as a single transition (no two-stage animation
 * where the modal slides down and then SetLogger pushes in).
 */
export function ExercisePickerScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>("pick")
  const activeDate = useActiveDate()

  // Hand off the create-workout + add-exercise work to SetLogger itself.
  // Doing the mutations here would re-render every snapshot subscriber on
  // the JS thread BEFORE the navigation message reaches native, blocking the
  // push animation. Forwarding only `pendingCreate` keeps this handler a
  // no-op: native gets the nav command immediately, the push animation
  // starts, and SetLogger commits the mutations once the animation has
  // settled. We pass the exercise name + category too so SetLogger can
  // render its full UI shell from the very first frame, before the actual
  // workoutId/weId are resolved.
  function gotoLogger(ex: Exercise) {
    navigation.replace("SetLogger", {
      pendingCreate: {
        date: activeDate,
        exerciseId: ex.id,
        exerciseName: ex.name,
        exerciseCategory: ex.category,
      },
    })
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      {mode === "pick" ? (
        <PickView
          onClose={() => navigation.goBack()}
          onPick={gotoLogger}
          onCreateNew={() => setMode("new")}
        />
      ) : (
        <NewExerciseView
          onBack={() => setMode("pick")}
          onCreated={(ex) => gotoLogger(ex)}
        />
      )}
    </SafeAreaView>
  )
}

function PickView({
  onClose,
  onPick,
  onCreateNew,
}: {
  onClose: () => void
  onPick: (ex: Exercise) => void
  onCreateNew: () => void
}) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const searchRef = useRef<TextInput>(null)
  const snapshot = useScreenSnapshot()
  // Defer the exercise-list query + FlatList until the picker's slide-in
  // animation has fully settled. listExercisesQ iterates every exercise and
  // annotates each with workouts_count + last_performed by joining through
  // workout_exercises × sets — heavy enough to stutter the push animation if
  // it runs on the same JS frames. `InteractionManager.runAfterInteractions`
  // waits for the navigation transition to finish, so the chrome paints on
  // the first frame, the slide stays smooth, and the list lands the moment
  // the animation completes.
  const [listReady, setListReady] = useState(false)
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setListReady(true))
    return () => handle.cancel()
  }, [])
  // Gate the category chips and the FlatList shell off the very first commit
  // so iOS native-stack can begin the picker's slide-in as soon as possible
  // after the "+" tap. The header + search input are the only things visible
  // during the slide; the chips + list shell mount one rAF later — invisible
  // to the user since the slide hasn't finished yet.
  const [chromeReady, setChromeReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setChromeReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const exercises = useMemo(
    () =>
      listReady
        ? listExercisesQ({
            q: search || undefined,
            category: category ?? undefined,
            sort: "last_performed",
          })
        : [],
    [snapshot, search, category, listReady]
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

      {/* Chips + list shell are off the first commit so iOS can start the
       *  picker's slide as soon as possible. Both mount one rAF later. */}
      {chromeReady && (
        <CategoryChips
          selected={category}
          onSelect={(cat) => setCategory(category === cat ? null : cat)}
          padded
        />
      )}

      {chromeReady && (
        <FlatList
          data={exercises}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ExerciseRow ex={item} onPress={() => onPick(item)} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            listReady ? (
              <Text style={{ color: theme.colors.muted, padding: theme.spacing[4] }}>
                No exercises match.
              </Text>
            ) : null
          }
        />
      )}
    </Pressable>
  )
}

function ExerciseRow({ ex, onPress }: { ex: Exercise; onPress: () => void }) {
  const { colors: catColors } = useCategoryStyles()
  const dotColor =
    catColors[ex.category] ?? theme.colors.cat[ex.category] ?? theme.colors.muted
  const subtitle = formatExerciseSubtitle(ex)
  return (
    <Pressable
      onPress={onPress}
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
