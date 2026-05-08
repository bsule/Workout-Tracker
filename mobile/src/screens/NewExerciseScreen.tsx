import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { localApi as api } from "@lift/core"
import { Button } from "../components/Button"
import { Input } from "../components/Input"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"

export function NewExerciseScreen({ navigation, route }: any) {
  const { date, workoutId } = route.params ?? {}
  const { categories, labels } = useCategoryStyles()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<string>("chest")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate() {
    setSubmitting(true)
    setError(null)
    try {
      const ex = await api.createExercise({ name: name.trim(), category })
      // chain: add to current/new workout, then jump to set logger
      let id = workoutId
      if (!id && date) {
        const w = await api.createWorkout(date)
        id = w.id
      }
      if (id) {
        const we = await api.addExerciseToWorkout(id, ex.id)
        navigation.replace("SetLogger", { workoutId: id, weId: we.id })
      } else {
        navigation.goBack()
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create exercise")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
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
      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {categories.map((c) => (
          <Button
            key={c}
            label={labels[c] ?? c}
            variant={category === c ? "primary" : "secondary"}
            onPress={() => setCategory(c)}
            style={{ flexBasis: "30%" }}
          />
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Create" onPress={onCreate} loading={submitting} disabled={!name.trim()} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: theme.spacing[4], gap: theme.spacing[4] },
  label: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
})
