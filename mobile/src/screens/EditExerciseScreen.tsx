import { usePrepareScreenReturn } from "../store/useScreenSnapshot"
import { useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import type { Exercise } from "@lift/core"
import { queryValue, useExerciseQuery, useWorkoutApi } from "@lift/engine-client/react"
import { useScreenQueryOptions } from "../engine/screenQuery"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { CategoryChips } from "../components/CategoryChips"
import { Input } from "../components/Input"

export function EditExerciseScreen({ navigation, route }: any) {
  const { exerciseId } = route.params
  const exerciseQuery = useExerciseQuery(exerciseId, useScreenQueryOptions())
  const exercise = queryValue(exerciseQuery, null)

  if (!exercise) {
    // Still reading: the background alone, not a claim that it is gone.
    if (exerciseQuery.status === "loading") return <View style={styles.flex} />
    return (
      <View style={[styles.flex, { padding: theme.spacing[4] }]}>
        <Text style={{ color: theme.colors.muted }}>Exercise not found.</Text>
      </View>
    )
  }
  // The form seeds its fields from the exercise once it is read.
  return <EditExerciseForm navigation={navigation} exercise={exercise} />
}

function EditExerciseForm({ navigation, exercise }: { navigation: any; exercise: Exercise }) {
  const api = useWorkoutApi()
  const prepareReturn = usePrepareScreenReturn()
  const [name, setName] = useState(exercise.name)
  const [category, setCategory] = useState<string>(exercise.category)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      await api.patchExercise(exercise.id, { name: trimmed, category })
      prepareReturn()
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
      <Input
        label="Name"
        value={name}
        onChangeText={setName}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
      />

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Category</Text>
        <CategoryChips selected={category} onSelect={setCategory} />
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
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
})
