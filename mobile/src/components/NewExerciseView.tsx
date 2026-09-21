import { useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { localApi as api } from "@lift/core"
import type { Exercise } from "@lift/core"
import { Button } from "./Button"
import { CategoryChips } from "./CategoryChips"
import { Input } from "./Input"
import { theme } from "../theme/theme"

/** The "New Exercise" form inside the exercise picker (screen and sheet). */
export function NewExerciseView({
  onBack,
  onCreated,
}: {
  onBack: () => void
  onCreated: (ex: Exercise) => void
}) {
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
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Bench Press"
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
        />

        <View style={{ gap: 6 }}>
          <Text style={styles.fieldLabel}>Category</Text>
          <CategoryChips selected={category} onSelect={setCategory} padded />
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
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
})
