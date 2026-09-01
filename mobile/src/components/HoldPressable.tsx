import { useCallback, useRef } from "react"
import {
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native"

export const HOLD_DELAY = 350

type Props = PressableProps & {
  /** Style for the animated wrapper, not the Pressable itself. */
  wrapperStyle?: StyleProp<ViewStyle>
  /** How far the card shrinks while the user holds it. */
  holdScale?: number
  holdDelay?: number
}

/**
 * A Pressable that shrinks while the user holds it, then eases back to rest
 * once the long press fires. The shrink runs for exactly `holdDelay`, so it
 * doubles as a progress indicator: the user sees the hold register before it
 * commits. There is no overshoot on the way back - a bounce here reads as the
 * row jumping, not as feedback.
 *
 * The ramp only runs when `onLongPress` is set. Without it the shrink would
 * promise an action that never arrives.
 *
 * The release that ends a long press does NOT fire `onPress`. Lifting your
 * finger after a hold is the end of that gesture, not a tap. This matters
 * wherever the long press changes what a tap means: holding a row to enter
 * selection mode re-renders it with a new `onPress`, and running that on the
 * release would immediately undo the selection the hold just made.
 */
export function HoldPressable({
  wrapperStyle,
  holdScale = 0.97,
  holdDelay = HOLD_DELAY,
  onLongPress,
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const scale = useRef(new Animated.Value(1)).current
  // The long press already fired for this gesture, so press-out must not
  // restart the settle that is already running.
  const heldRef = useRef(false)

  const settle = useCallback(
    (duration: number) => {
      Animated.timing(scale, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    },
    [scale]
  )

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      heldRef.current = false
      if (onLongPress) {
        Animated.timing(scale, {
          toValue: holdScale,
          duration: holdDelay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start()
      }
      onPressIn?.(e)
    },
    [scale, holdScale, holdDelay, onLongPress, onPressIn]
  )

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (!heldRef.current) settle(130)
      onPressOut?.(e)
    },
    [settle, onPressOut]
  )

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      // Set by handleLongPress, cleared on the next press-in. RN fires
      // onPressOut before onPress, so this is still true here.
      if (heldRef.current) return
      onPress?.(e)
    },
    [onPress]
  )

  const handleLongPress = useCallback(
    (e: GestureResponderEvent) => {
      heldRef.current = true
      settle(190)
      onLongPress?.(e)
    },
    [settle, onLongPress]
  )

  return (
    <Animated.View style={[wrapperStyle, { transform: [{ scale }] }]}>
      <Pressable
        {...rest}
        onLongPress={onLongPress ? handleLongPress : undefined}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        delayLongPress={holdDelay}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}
