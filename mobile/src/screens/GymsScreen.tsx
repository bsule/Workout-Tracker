import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Alert,
  Animated,
  Keyboard,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { localApi as api, useStore } from "@lift/core"
import type { Gym } from "@lift/core"
import { Button } from "../components/Button"
import { EASE, LIST_ANIM } from "../anim"
import { theme } from "../theme/theme"
import { Card } from "../components/Card"

function animateGyms() {
  LayoutAnimation.configureNext(LIST_ANIM)
}

export function GymsScreen() {
  const gyms = useStore((s) => s.snapshot.gyms) as Gym[]
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  // Rows playing their exit. The gym stays in the store until its row has
  // collapsed, so the rows under it slide up in step with the fade.
  const [removingIds, setRemovingIds] = useState<ReadonlySet<number>>(new Set())

  // Keys of rows already on screen. A row whose key is not in here yet is a
  // gym that was just added, and it plays the enter animation. Seeded with
  // the first render's gyms so opening the page animates nothing.
  const knownKeys = useRef<Set<string> | null>(null)
  if (knownKeys.current == null) {
    knownKeys.current = new Set(gyms.map(gymKey))
  }
  useEffect(() => {
    for (const g of gyms) knownKeys.current!.add(gymKey(g))
  }, [gyms])

  function addGym() {
    const trimmed = draft.trim()
    if (!trimmed) return
    setError(null)
    try {
      // The first gym swaps the "No gyms yet" line for the list card. Later
      // ones animate their own row instead (GymRowTransition).
      if (gyms.length === 0) animateGyms()
      api.createGym(trimmed)
      setDraft("")
      Keyboard.dismiss()
    } catch (e) {
      animateGyms()
      setError(e instanceof Error ? e.message : "Failed to add gym.")
    }
  }

  function startEdit(g: Gym) {
    if (g.id == null) return
    // The row is replaced by a taller edit form, so the rows under it move.
    animateGyms()
    setEditingId(g.id)
    setEditDraft(g.name)
    setEditError(null)
  }
  function cancelEdit() {
    Keyboard.dismiss()
    animateGyms()
    setEditingId(null)
    setEditDraft("")
    setEditError(null)
  }
  function commitEdit() {
    if (editingId == null) return
    const trimmed = editDraft.trim()
    if (!trimmed) {
      animateGyms()
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
      animateGyms()
      setEditError("A gym with that name already exists.")
      return
    }
    Keyboard.dismiss()
    animateGyms()
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
            const id = g.id
            if (id == null) return
            setRemovingIds((prev) => new Set(prev).add(id))
          },
        },
      ]
    )
  }

  function finishRemove(id: number) {
    // The last gym leaving swaps the list card for the "No gyms yet" line.
    if (gyms.length === 1) animateGyms()
    api.deleteGym(id)
    setRemovingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  return (
    // Pushed route with a native header, which already clears the status
    // bar. StaticSafeAreaView would pad the top a second time.
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
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
        </Card>

        {gyms.length === 0 ? (
          <Text style={styles.empty}>No gyms yet.</Text>
        ) : (
          <Card style={styles.listCard}>
            {gyms.map((g) => {
              const isEditing = editingId != null && g.id === editingId
              const key = gymKey(g)
              const id = g.id
              return (
                <GymRowTransition
                  key={key}
                  entering={!knownKeys.current!.has(key)}
                  removing={id != null && removingIds.has(id)}
                  onRemoved={() => id != null && finishRemove(id)}
                >
                <View style={styles.rowWrap}>
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
                </GymRowTransition>
              )
            })}
          </Card>
        )}
      </ScrollView>
    </View>
  )
}

function gymKey(g: Gym): string {
  return String(g.id ?? g.name)
}

const ENTER_MS = 260
const EXIT_MS = 220

/**
 * A gym row's arrival and departure. On add, the row opens from zero height
 * while it fades in and settles down into place. On delete, it fades and
 * slides left while it collapses, then calls `onRemoved` so the store change
 * lands after the motion rather than cutting it short.
 *
 * Two views, because the height is JS-driven (layout) and the fade and slide
 * are native-driven, and one view cannot carry both. The inner view is
 * measured at its natural height even while the outer one is clipped to 0.
 */
function GymRowTransition({
  entering,
  removing,
  onRemoved,
  children,
}: {
  entering: boolean
  removing: boolean
  onRemoved: () => void
  children: ReactNode
}) {
  const [phase, setPhase] = useState<"enter" | "idle" | "exit">(
    entering ? "enter" : "idle"
  )
  const height = useRef(new Animated.Value(0)).current
  const shown = useRef(new Animated.Value(entering ? 0 : 1)).current
  const naturalHeight = useRef(0)
  const enterStarted = useRef(false)
  const onRemovedRef = useRef(onRemoved)
  onRemovedRef.current = onRemoved
  const removingRef = useRef(removing)
  removingRef.current = removing
  const removedRef = useRef(false)

  function onLayout(h: number) {
    naturalHeight.current = h
    if (phase !== "enter" || enterStarted.current) return
    enterStarted.current = true
    Animated.timing(height, {
      toValue: h,
      duration: ENTER_MS,
      easing: EASE.out,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setPhase("idle")
    })
    Animated.timing(shown, {
      toValue: 1,
      duration: ENTER_MS - 40,
      delay: 40,
      easing: EASE.out,
      useNativeDriver: true,
    }).start()
  }

  useEffect(() => {
    if (!removing) return
    height.stopAnimation()
    shown.stopAnimation()
    height.setValue(naturalHeight.current)
    setPhase("exit")
  }, [removing, height, shown])

  // Started once the exit style (clipped height, sideways slide) is on
  // screen, so the motion never runs against the enter transform.
  useEffect(() => {
    if (phase !== "exit") return
    Animated.timing(shown, {
      toValue: 0,
      duration: EXIT_MS - 60,
      easing: EASE.in,
      useNativeDriver: true,
    }).start()
    Animated.timing(height, {
      toValue: 0,
      duration: EXIT_MS,
      easing: EASE.inOut,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !removedRef.current) {
        removedRef.current = true
        onRemovedRef.current()
      }
    })
  }, [phase, height, shown])

  // Leaving the page mid-exit must not lose a delete the user confirmed.
  useEffect(
    () => () => {
      if (removingRef.current && !removedRef.current) {
        removedRef.current = true
        onRemovedRef.current()
      }
    },
    []
  )

  const offset =
    phase === "exit"
      ? { translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }
      : { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }

  return (
    <Animated.View
      style={phase === "idle" ? undefined : { height, overflow: "hidden" }}
      pointerEvents={phase === "exit" ? "none" : "auto"}
    >
      <Animated.View
        onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
        style={[styles.rowSpacing, { opacity: shown, transform: [offset] }]}
      >
        {children}
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // The rows carry the space between them (rowSpacing) instead of the card's
  // gap, so a collapsing row takes its gap with it and nothing jumps at the
  // end. The bottom padding makes up the last row's spacing: 12 + 4 = 16, the
  // card's usual padding.
  listCard: {
    gap: 0,
    paddingBottom: theme.spacing[4] - theme.spacing[3],
  },
  rowSpacing: { paddingBottom: theme.spacing[3] },
  wrap: {
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
