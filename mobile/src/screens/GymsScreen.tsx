import { useState } from "react"
import {
  Alert,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { localApi as api, useStore } from "@lift/core"
import type { Gym } from "@lift/core"
import { Button } from "../components/Button"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// Opacity-driven enter/exit + an easeInEaseOut height settle. scaleXY
// looks janky on full-width rows because the row scales toward a
// corner; fading them in/out while the surrounding rows slide into
// place reads as a single smooth motion.
const GYM_ANIM = {
  duration: 240,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 240,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 240,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 200,
  },
} as const

function animateGyms() {
  LayoutAnimation.configureNext(GYM_ANIM)
}

export function GymsScreen() {
  const gyms = useStore((s) => s.snapshot.gyms) as Gym[]
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [editError, setEditError] = useState<string | null>(null)

  function addGym() {
    const trimmed = draft.trim()
    if (!trimmed) return
    setError(null)
    try {
      animateGyms()
      api.createGym(trimmed)
      setDraft("")
      Keyboard.dismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add gym.")
    }
  }

  function startEdit(g: Gym) {
    if (g.id == null) return
    setEditingId(g.id)
    setEditDraft(g.name)
    setEditError(null)
  }
  function cancelEdit() {
    Keyboard.dismiss()
    setEditingId(null)
    setEditDraft("")
    setEditError(null)
  }
  function commitEdit() {
    if (editingId == null) return
    const trimmed = editDraft.trim()
    if (!trimmed) {
      setEditError("Name can't be empty.")
      return
    }
    const current = gyms.find((g) => g.id === editingId)
    if (!current) {
      cancelEdit()
      return
    }
    if (trimmed === current.name) {
      cancelEdit()
      return
    }
    const collision = gyms.some(
      (g) => g.id !== editingId && g.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (collision) {
      setEditError("A gym with that name already exists.")
      return
    }
    Keyboard.dismiss()
    api.renameGym(editingId, trimmed)
    setEditingId(null)
    setEditDraft("")
    setEditError(null)
  }

  function confirmDeleteGym(g: Gym) {
    if (g.id == null) return
    Keyboard.dismiss()
    Alert.alert(
      "Remove gym?",
      `"${g.name}" will be removed from your saved gyms. Existing workouts that used this name will keep their gym text.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (g.id != null) {
              animateGyms()
              api.deleteGym(g.id)
            }
          },
        },
      ]
    )
  }

  return (
    <StaticSafeAreaView>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.addRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a gym…"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={addGym}
              style={styles.input}
            />
            <Button
              label="Add"
              onPress={addGym}
              disabled={!draft.trim()}
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        {gyms.length === 0 ? (
          <Text style={styles.empty}>No gyms yet.</Text>
        ) : (
          <View style={styles.card}>
            {gyms.map((g) => {
              const isEditing = editingId != null && g.id === editingId
              return (
                <View key={String(g.id ?? g.name)} style={styles.rowWrap}>
                  <View style={styles.row}>
                    {isEditing ? (
                      <TextInput
                        value={editDraft}
                        onChangeText={setEditDraft}
                        autoFocus
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={commitEdit}
                        style={[styles.input, styles.editInput]}
                      />
                    ) : (
                      <Text style={styles.name} numberOfLines={1}>
                        {g.name}
                      </Text>
                    )}
                    {isEditing ? (
                      <>
                        <Pressable
                          onPress={cancelEdit}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.iconBtn,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons
                            name="close"
                            size={18}
                            color={theme.colors.muted}
                          />
                        </Pressable>
                        <Pressable
                          onPress={commitEdit}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.iconBtn,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons
                            name="checkmark"
                            size={18}
                            color={theme.colors.foreground}
                          />
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Pressable
                          onPress={() => startEdit(g)}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.iconBtn,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons
                            name="pencil"
                            size={16}
                            color={theme.colors.foreground}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => confirmDeleteGym(g)}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.iconBtn,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={16}
                            color={theme.colors.destructive}
                          />
                        </Pressable>
                      </>
                    )}
                  </View>
                  {isEditing && editError && (
                    <Text style={styles.error}>{editError}</Text>
                  )}
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </StaticSafeAreaView>
  )
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  rowWrap: {
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 6,
  },
  name: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  editInput: {
    paddingVertical: theme.spacing[2],
  },
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  empty: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    paddingHorizontal: theme.spacing[2],
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
})
