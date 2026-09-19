import { Animated } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { theme } from "../theme/theme"

/**
 * The chevron on anything that expands in place. Points down when closed, and
 * turns a half circle to point up when open.
 *
 * Pair it with `useExpandToggle`, which owns the value: the turn is a
 * transform, so it runs on the native driver and keeps going while the
 * container's LayoutAnimation height change blocks the JS thread.
 *
 * This is not the chevron on a menu anchor. iOS leaves a menu's anchor alone
 * and lets the menu appearing be the feedback, so those stay static.
 */
export function SpinChevron({
  progress,
  size = 14,
  color = theme.colors.muted,
}: {
  /** 0 = closed (pointing down), 1 = open (pointing up). */
  progress: Animated.AnimatedInterpolation<number> | Animated.Value
  size?: number
  color?: string
}) {
  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "180deg"],
            }),
          },
        ],
      }}
    >
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  )
}
