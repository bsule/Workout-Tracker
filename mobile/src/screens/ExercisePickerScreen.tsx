import { useEffect, useMemo, useState } from "react"
import {
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  listExercisesQ,
  localApi as api,
  useStore,
} from "@lift/core"
import type { Exercise } from "@lift/core"
import { Button } from "../components/Button"
import { useActiveDate } from "../state/activeDate"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"

type Mode = "pick" | "new"

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

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
  const { categories, labels, colors: catColors } = useCategoryStyles()
  function colorFor(c: string): string {
    return catColors[c] ?? theme.colors.cat[c] ?? theme.colors.muted
  }
  const snapshot = useStore((s) => s.snapshot)
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
    <>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="close" size={28} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title}>Choose Exercise</Text>
        <Pressable onPress={onCreateNew} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="add" size={28} color={theme.colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={theme.colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Exercise Name"
          placeholderTextColor={theme.colors.muted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Chips + list shell are off the first commit so iOS can start the
       *  picker's slide as soon as possible. Both mount one rAF later. */}
      {chromeReady && (
        <View style={styles.chipsGrid}>
          {categories.map((cat) => {
            const active = category === cat
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(active ? null : cat)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <View style={[styles.chipDot, { backgroundColor: colorFor(cat) }]} />
                <Text style={styles.chipText}>{labels[cat] ?? cat}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {chromeReady && (
        <FlatList
          data={exercises}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
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
    </>
  )
}

function ExerciseRow({ ex, onPress }: { ex: Exercise; onPress: () => void }) {
  const { colors: catColors } = useCategoryStyles()
  const dotColor =
    catColors[ex.category] ?? theme.colors.cat[ex.category] ?? theme.colors.muted
  const subtitle = formatSubtitle(ex)
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

function formatSubtitle(ex: Exercise): string {
  const count = ex.workouts_count ?? 0
  const days = ex.last_performed_days_ago ?? null
  if (count === 0) return "0 workouts"
  if (days == null) return `${count} workout${count === 1 ? "" : "s"}`
  return `${count} workout${count === 1 ? "" : "s"} (${formatDays(days)})`
}

function formatDays(d: number): string {
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 7) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) === 1 ? "" : "s"} ago`
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) === 1 ? "" : "s"} ago`
  return "last year"
}

function NewExerciseView({
  onBack,
  onCreated,
}: {
  onBack: () => void
  onCreated: (ex: Exercise) => void
}) {
  const { categories, labels, colors: catColors } = useCategoryStyles()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<string>("chest")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate() {
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const ex = await api.createExercise({ name: name.trim(), category })
      onCreated(ex)
    } catch (e: any) {
      setError(e?.message ?? "Failed to create exercise")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title}>New Exercise</Text>
        <View style={styles.headerSideBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.newWrap}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Bench Press"
            placeholderTextColor={theme.colors.muted}
            style={styles.nameInput}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chipsGrid}>
            {categories.map((cat) => {
              const active = category === cat
              const dot =
                catColors[cat] ?? theme.colors.cat[cat] ?? theme.colors.muted
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <View style={[styles.chipDot, { backgroundColor: dot }]} />
                  <Text style={styles.chipText}>{labels[cat] ?? cat}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          label="Create exercise"
          onPress={onCreate}
          loading={submitting}
          disabled={!name.trim()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
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
    paddingVertical: theme.spacing[3],
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  search: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    padding: 0,
  },
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  chip: {
    flexBasis: "23%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipActive: { backgroundColor: theme.colors.cardElevated, borderColor: theme.colors.foreground },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
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
  newWrap: {
    padding: theme.spacing[4],
    gap: theme.spacing[5],
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  nameInput: {
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
})
