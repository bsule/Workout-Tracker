import { useMemo, useState } from "react"
import {
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
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"

export function EditExerciseScreen({ navigation, route }: any) {
  const { exerciseId } = route.params
  const snapshot = useStore((s) => s.snapshot)

  const exercise = useMemo(
    () => listExercisesQ({ sort: "name" }).find((e) => e.id === exerciseId) ?? null,
    [snapshot, exerciseId]
  )

  const { categories, labels, colors: catColors } = useCategoryStyles()
  const [name, setName] = useState(exercise?.name ?? "")
  const [category, setCategory] = useState<string>(exercise?.category ?? "chest")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!exercise) {
    return (
      <View style={[styles.flex, { padding: theme.spacing[4] }]}>
        <Text style={{ color: theme.colors.muted }}>Exercise not found.</Text>
      </View>
    )
  }

  async function onSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      await api.patchExercise(exercise!.id, { name: trimmed, category })
      navigation.goBack()
    } catch (e: any) {
      setError(e?.message ?? "Failed to save")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerSideBtn}>
          <Ionicons name="close" size={28} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Exercise</Text>
        <View style={styles.headerSideBtn} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
      >
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          style={styles.nameInput}
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Category</Text>
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
        label="Save"
        onPress={onSave}
        loading={submitting}
        disabled={!name.trim()}
      />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  headerSideBtn: { width: 32, alignItems: "center" },
  headerTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.md, fontWeight: "700" },
  wrap: { padding: theme.spacing[4], gap: theme.spacing[5] },
  label: {
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
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
})
