import { useMemo, useRef, useState, type MutableRefObject } from "react"
import {
  Alert,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { Swipeable } from "react-native-gesture-handler"
import { listExercisesQ, localApi as api, useStore } from "@lift/core"
import type { Exercise } from "@lift/core"
import { CategoryBadge } from "../components/CategoryBadge"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"
import { useCategoryColor } from "../categories/CategoryStylesProvider"

export function ExercisesScreen({ navigation }: any) {
  const [search, setSearch] = useState("")
  const openSwipeableRef = useRef<Swipeable | null>(null)
  const snapshot = useStore((s) => s.snapshot)
  const exercises = useMemo(
    () => listExercisesQ({ q: search || undefined, sort: "last_performed" }),
    [snapshot, search]
  )

  function openDetail(ex: Exercise) {
    navigation.navigate("ExerciseDetail", { exerciseId: ex.id })
  }

  function openCreate() {
    navigation.navigate("NewExercise", {})
  }

  function editExercise(ex: Exercise) {
    navigation.navigate("EditExercise", { exerciseId: ex.id })
  }

  function deleteExercise(ex: Exercise) {
    Alert.alert(
      "Delete exercise?",
      `${ex.name} will be removed. Past sets stay in history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => api.deleteExercise(ex.id),
        },
      ]
    )
  }

  return (
    <StaticSafeAreaView>
      <View style={styles.header}>
        <View style={{ width: 32 }} />
        <Text style={styles.title}>Exercises</Text>
        <Pressable
          onPress={openCreate}
          hitSlop={12}
          style={({ pressed }) => [styles.headerSideBtn, pressedStyle(pressed)]}
        >
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

      <FlatList
        style={styles.list}
        data={exercises}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <ExerciseRow
            ex={item}
            openSwipeableRef={openSwipeableRef}
            onPress={() => openDetail(item)}
            onEdit={() => editExercise(item)}
            onDelete={() => deleteExercise(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </StaticSafeAreaView>
  )
}

function ExerciseRow({
  ex,
  openSwipeableRef,
  onPress,
  onEdit,
  onDelete,
}: {
  ex: Exercise
  openSwipeableRef: MutableRefObject<Swipeable | null>
  onPress: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const subtitle = formatSubtitle(ex)
  const dotColor = useCategoryColor(ex.category)
  const swipeableRef = useRef<Swipeable | null>(null)
  // Per-touch tracking so swipes that don't reach the open threshold still
  // suppress the row's onPress (the underlying issue: Pressable doesn't get
  // a touch-cancel from the legacy Swipeable's pan gesture for small drags,
  // so a short swipe-back ends up firing onPress and navigating).
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  // Suppress onPress for a short window after any swipe activity (will-open /
  // will-close), since the same touch sequence often releases inside row bounds.
  const lastSwipeAt = useRef(0)
  const HORIZONTAL_TAP_TOLERANCE = 8

  function closeThen(action: () => void) {
    swipeableRef.current?.close()
    if (openSwipeableRef.current === swipeableRef.current) {
      openSwipeableRef.current = null
    }
    action()
  }

  function handleRowPress() {
    // Suppressed when the touch had any meaningful horizontal motion or when
    // a swipe began/ended in the last 350ms.
    if (moved.current) return
    if (Date.now() - lastSwipeAt.current < 350) return
    if (openSwipeableRef.current) {
      // Tap while another row is open — just close it, don't navigate.
      openSwipeableRef.current.close()
      openSwipeableRef.current = null
      return
    }
    closeThen(onPress)
  }

  return (
    <Swipeable
      ref={swipeableRef}
      useNativeAnimations
      friction={1.4}
      rightThreshold={10}
      dragOffsetFromRightEdge={5}
      activeOffsetX={[-5, 5]}
      failOffsetY={[-30, 30]}
      overshootLeft={false}
      overshootRight={false}
      animationOptions={{
        overshootClamping: true,
        bounciness: 0,
        speed: 14,
      }}
      containerStyle={styles.swipeContainer}
      childrenContainerStyle={styles.swipeChild}
      onSwipeableWillOpen={() => {
        lastSwipeAt.current = Date.now()
        if (openSwipeableRef.current && openSwipeableRef.current !== swipeableRef.current) {
          openSwipeableRef.current.close()
        }
        openSwipeableRef.current = swipeableRef.current
      }}
      onSwipeableWillClose={() => {
        lastSwipeAt.current = Date.now()
        if (openSwipeableRef.current === swipeableRef.current) {
          openSwipeableRef.current = null
        }
      }}
      renderRightActions={(progress, dragX) => {
        // Two 36-wide circular buttons + 8px gap + 8px padding = ~96px reveal.
        // Buttons sit on a transparent track so they read as row tools.
        const translateX = dragX.interpolate({
          inputRange: [-96, 0],
          outputRange: [0, 96],
          extrapolate: "clamp",
        })
        const groupOpacity = progress.interpolate({
          inputRange: [0, 0.05, 0.25, 1],
          outputRange: [0, 0, 1, 1],
          extrapolate: "clamp" as const,
        })
        return (
          <Animated.View
            style={[
              styles.swipeActions,
              { transform: [{ translateX }], opacity: groupOpacity },
            ]}
          >
            <Pressable
              onPress={() => closeThen(onEdit)}
              style={({ pressed }) => [
                styles.swipeAction,
                styles.swipeActionEdit,
                pressed && styles.swipeActionPressed,
              ]}
              hitSlop={4}
            >
              <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => closeThen(onDelete)}
              style={({ pressed }) => [
                styles.swipeAction,
                styles.swipeActionDelete,
                pressed && styles.swipeActionPressed,
              ]}
              hitSlop={4}
            >
              <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
            </Pressable>
          </Animated.View>
        )
      }}
    >
      <Pressable
        onPressIn={(e) => {
          touchStart.current = {
            x: e.nativeEvent.pageX,
            y: e.nativeEvent.pageY,
          }
          moved.current = false
        }}
        onTouchMove={(e) => {
          const start = touchStart.current
          if (!start) return
          const dx = Math.abs(e.nativeEvent.pageX - start.x)
          const dy = Math.abs(e.nativeEvent.pageY - start.y)
          if (dx > HORIZONTAL_TAP_TOLERANCE && dx > dy) {
            moved.current = true
          }
        }}
        onPress={handleRowPress}
        style={({ pressed }) => [styles.row, !moved.current && pressedStyle(pressed)]}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{ex.name}</Text>
          <Text style={styles.sub}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
      </Pressable>
    </Swipeable>
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

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  headerSideBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
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
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 14,
    backgroundColor: theme.colors.background,
  },
  swipeContainer: {
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  swipeChild: {
    backgroundColor: theme.colors.background,
  },
  swipeActions: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    paddingHorizontal: 8,
    gap: 8,
    backgroundColor: theme.colors.background,
  },
  swipeAction: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  swipeActionEdit: {
    backgroundColor: "rgba(0,119,188,0.14)",
    borderColor: "rgba(0,119,188,0.32)",
  },
  swipeActionDelete: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.32)",
  },
  swipeActionPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.92 }],
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  sub: { color: theme.colors.muted, fontSize: theme.fontSize.sm, marginTop: 2 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[4],
  },
})
