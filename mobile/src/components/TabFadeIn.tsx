import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import { Animated, StyleSheet } from "react-native"
import { useNavigationState, useRoute } from "@react-navigation/native"

// Tab fade-in driven by a per-tab Animated.Value owned by this component.
// Replaces the bottom-tab navigator's built-in `animation: "fade"`, which
// shares a single Animated.Value map across all tabs and could leave a
// destination tab's opacity stuck at 0 (black screen) on rapid retaps.
//
// Why this version doesn't have that bug:
//  - Each TabFadeIn instance owns one Animated.Value, scoped to one tab.
//  - On every focus event we `stopAnimation()` + `setValue(0.6)` before
//    starting the new timing, so the value cannot be left in an in-between
//    state by an interrupted prior animation.
//
// Why we use the tab navigator's state.index, not useFocusEffect: focus
// restores fire on stack pop (e.g. SetLogger → DayScreen) as well as on
// tab switch, so useFocusEffect would re-fade after every back navigation.
// The bottom-tab nav's state.index, by contrast, only changes on actual
// tab switches — push/pop on the OUTER stack leaves it untouched.
export function TabFadeIn({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current
  const route = useRoute()

  const tabIsFocused = useNavigationState(
    (state) => !!state && state.routes[state.index]?.key === route.key
  )

  const wasFocusedRef = useRef(tabIsFocused)

  useEffect(() => {
    const wasFocused = wasFocusedRef.current
    wasFocusedRef.current = tabIsFocused
    if (!tabIsFocused || wasFocused) return

    opacity.stopAnimation()
    opacity.setValue(0.6)
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start()
  }, [tabIsFocused, opacity])

  return (
    <Animated.View style={[styles.flex, { opacity }]}>{children}</Animated.View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
})
