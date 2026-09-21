import { useEffect, useMemo, useState } from "react"
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import Modal from "react-native-modal"
import { Ionicons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  listExercisesQ,
  useStore,
} from "@lift/core"
import type { Exercise } from "@lift/core"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"
import { formatExerciseSubtitle } from "../format"
import { CategoryChips } from "./CategoryChips"
import { NewExerciseView } from "./NewExerciseView"

interface Props {
  visible: boolean
  onClose: () => void
  onPick: (ex: Exercise) => void
  /** "single" (default) auto-closes on the first pick. "multi" lets the user
   *  toggle multiple rows and confirm with Done, which fires `onPickMany`. */
  mode?: "single" | "multi"
  onPickMany?: (exs: Exercise[]) => void
  /** Initial selection in multi mode. */
  initialSelectedIds?: number[]
}

type ViewMode = "pick" | "new"

export function ExercisePickerSheet({
  visible,
  onClose,
  onPick,
  mode = "single",
  onPickMany,
  initialSelectedIds,
}: Props) {
  const [view, setView] = useState<ViewMode>("pick")

  // Reset to the pick mode each time the sheet opens — never resume mid-form.
  useEffect(() => {
    if (visible) setView("pick")
  }, [visible])

  return (
    <Modal
      isVisible={visible}
      animationIn="slideInUp"
      animationOut="slideOutDown"
      animationInTiming={260}
      animationOutTiming={220}
      backdropOpacity={0}
      onBackButtonPress={onClose}
      useNativeDriver
      hideModalContentWhileAnimating
      style={styles.modal}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={["top"]}>
        {view === "pick" ? (
          <PickView
            onClose={onClose}
            onPick={onPick}
            onCreateNew={() => setView("new")}
            mode={mode}
            onPickMany={onPickMany}
            initialSelectedIds={initialSelectedIds}
          />
        ) : (
          <NewExerciseView
            onBack={() => setView("pick")}
            onCreated={(ex) => onPick(ex)}
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}

// ---------------- Pick view ----------------------------------------

function PickView({
  onClose,
  onPick,
  onCreateNew,
  mode,
  onPickMany,
  initialSelectedIds,
}: {
  onClose: () => void
  onPick: (ex: Exercise) => void
  onCreateNew: () => void
  mode: "single" | "multi"
  onPickMany?: (exs: Exercise[]) => void
  initialSelectedIds?: number[]
}) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const snapshot = useStore((s) => s.snapshot)
  const exercises = useMemo(
    () =>
      listExercisesQ({
        q: search || undefined,
        category: category ?? undefined,
        sort: "last_performed",
      }),
    [snapshot, search, category]
  )

  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(initialSelectedIds ?? [])
  )

  function toggle(ex: Exercise) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(ex.id)) next.delete(ex.id)
      else next.add(ex.id)
      return next
    })
  }

  function onDone() {
    if (!onPickMany) return
    const chosen = exercises.filter((e) => selectedIds.has(e.id))
    // include any selected items that aren't in the current filter view
    if (selectedIds.size > chosen.length) {
      const haveIds = new Set(chosen.map((e) => e.id))
      const missing = listExercisesQ().filter(
        (e) => selectedIds.has(e.id) && !haveIds.has(e.id)
      )
      chosen.push(...missing)
    }
    onPickMany(chosen)
  }

  const isMulti = mode === "multi"

  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="close" size={28} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title}>
          {isMulti ? "Choose Exercises" : "Choose Exercise"}
        </Text>
        {isMulti ? (
          <Pressable onPress={onDone} hitSlop={12} style={styles.headerSideBtn}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onCreateNew} hitSlop={12} style={styles.headerSideBtn}>
            <Ionicons name="add" size={28} color={theme.colors.foreground} />
          </Pressable>
        )}
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

      <CategoryChips
        selected={category}
        onSelect={(cat) => setCategory(category === cat ? null : cat)}
        padded
      />

      <FlatList
        data={exercises}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <ExerciseRow
            ex={item}
            selected={isMulti ? selectedIds.has(item.id) : false}
            showCheckbox={isMulti}
            onPress={() => (isMulti ? toggle(item) : onPick(item))}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.muted, padding: theme.spacing[4] }}>
            No exercises match.
          </Text>
        }
      />
    </>
  )
}

function ExerciseRow({
  ex,
  onPress,
  selected,
  showCheckbox,
}: {
  ex: Exercise
  onPress: () => void
  selected?: boolean
  showCheckbox?: boolean
}) {
  const { colors: catColors } = useCategoryStyles()
  const dotColor =
    catColors[ex.category] ?? theme.colors.cat[ex.category] ?? theme.colors.muted
  const subtitle = formatExerciseSubtitle(ex)
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={[styles.rowDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{ex.name}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      {showCheckbox && (
        <Ionicons
          name={selected ? "checkbox" : "square-outline"}
          size={22}
          color={selected ? theme.colors.foreground : theme.colors.muted}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  modal: { margin: 0 },
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
  doneText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
})
