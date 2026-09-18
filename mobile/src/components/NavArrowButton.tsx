/**
 * The app's step-backward / step-forward arrow.
 *
 * One definition for every in-screen pager arrow: the day switcher on the Today
 * tab and the month switcher on the Calendar tab. Before this, those two drew
 * their own and had drifted apart - different chevron sizes, and two different
 * press treatments (a 0.85 scale on one, the standard background tint on the
 * other).
 *
 * ## Why this is a bare chevron and not a disc
 *
 * iOS does not put pager arrows on a filled circle. Look at the stepper in the
 * system Calendar app or in a `UIDatePicker`: the arrow is a bare chevron in the
 * tint colour, and pressing it dims the glyph. An earlier version of this file
 * wrapped the chevron in a translucent disc to look like an iOS 26 bar button.
 * That was the wrong reference - a bar button is a chrome control, and these are
 * content controls.
 *
 * ## Why SF Symbols
 *
 * Ionicons' `chevron-back` is not Apple's chevron. It is thinner, its corners
 * are rounder, and its angle is shallower, so a row of them never quite reads as
 * native. `SymbolView` from `expo-symbols` draws the real `chevron.left` and
 * `chevron.right`, weight-matched to the surrounding text.
 *
 * `expo-symbols` is a native module, so it only exists in a binary built with
 * it. `requireOptionalNativeModule` returns null rather than throwing when it is
 * absent, which is what makes the check below safe - the same situation that
 * put an "Unimplemented component" on the Today screen when `MenuView` was
 * added without a guard. Until the next native build, this falls back to the
 * Ionicons chevron, which is the glyph the app has always used. No code change
 * is needed to pick up the real symbols later.
 */

import {
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import type { ComponentType } from "react"
import { requireOptionalNativeModule } from "expo-modules-core"
import { Ionicons } from "@expo/vector-icons"
import { theme } from "../theme/theme"

export const NAV_ARROW_SIZE = 22
const HIT_AREA = 36

/**
 * Whether this binary contains expo-symbols' native module. Read once: it is a
 * property of the binary and cannot change while the app runs.
 * `requireOptionalNativeModule` returns null instead of throwing when it is
 * absent, which is the whole reason this check is safe to run at load.
 */
const SF_SYMBOLS_AVAILABLE =
  Platform.OS === "ios" && !!requireOptionalNativeModule("SymbolModule")

/**
 * Loaded with `require`, not a static import, and only once the native module
 * is confirmed present. `expo-symbols` resolves its native view at module load,
 * so a static import would run that resolution in binaries that have no such
 * view. The try/catch is belt and braces on top of that.
 */
const SymbolView: ComponentType<Record<string, unknown>> | null =
  SF_SYMBOLS_AVAILABLE
    ? (() => {
        try {
          return require("expo-symbols").SymbolView ?? null
        } catch {
          return null
        }
      })()
    : null

export function NavArrowButton({
  direction,
  onPress,
  accessibilityLabel,
  style,
}: {
  direction: "back" | "forward"
  onPress: () => void
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}) {
  const glyph = SymbolView ? (
    <SymbolView
      name={direction === "back" ? "chevron.left" : "chevron.right"}
      size={NAV_ARROW_SIZE}
      tintColor={theme.colors.foreground}
      // Semibold matches how iOS draws a chevron next to bold text. The
      // default weight looks spindly at this size.
      weight="semibold"
      resizeMode="scaleAspectFit"
    />
  ) : (
    <Ionicons
      name={direction === "back" ? "chevron-back" : "chevron-forward"}
      size={NAV_ARROW_SIZE}
      color={theme.colors.foreground}
    />
  )

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      // iOS holds a Pressable's onPress for a scroll-detection window. These
      // are taps on a pager, where that is pure latency.
      unstable_pressDelay={0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // Dim on press, the way iOS treats a bare chevron. There is no
      // background to tint.
      style={({ pressed }) => [styles.btn, pressed && styles.pressed, style]}
    >
      {glyph}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: HIT_AREA,
    height: HIT_AREA,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.35 },
})
