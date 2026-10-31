import type { ReactNode } from "react"
import type { StyleProp, ViewStyle } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated"

/**
 * The action buttons behind a swiped row (ReanimatedSwipeable's
 * renderRightActions). The tray follows the row's translation, including the
 * release spring, and fades in with the swipe's progress. Both run on the UI
 * thread, so the tray keeps up with fast flicks.
 */
export function SwipeActionTray({
  progress,
  translation,
  width,
  fade,
  style,
  children,
}: {
  progress: SharedValue<number>
  translation: SharedValue<number>
  /** How far the row opens: the tray's own width. */
  width: number
  /** Opacity over progress (0 closed, 1 fully open). */
  fade: { input: number[]; output: number[] }
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, fade.input, fade.output, Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(translation.value, [-width, 0], [0, width], Extrapolation.CLAMP),
      },
    ],
  }))
  return <Animated.View style={[style, animated]}>{children}</Animated.View>
}
