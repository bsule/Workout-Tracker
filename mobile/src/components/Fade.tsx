import { useRef, type ReactNode } from "react"
import {
  Animated,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { DUR, EASE, useToggleTiming } from "../anim"

/**
 * An absolutely positioned layer that fades in when `active` turns true.
 * Use it instead of toggling a static background or border style, so a
 * selected state arrives over a few frames rather than in one.
 *
 * Place it as the first child of the row it highlights: it fills the parent
 * and later siblings draw on top of it.
 */
export function FadeHighlight({
  active,
  style,
}: {
  active: boolean
  style?: StyleProp<ViewStyle>
}) {
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current
  useToggleTiming(anim, active, {
    inMs: DUR.highlightIn,
    outMs: DUR.highlightOut,
    easeIn: EASE.out,
    easeOut: EASE.in,
  })

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style, { opacity: anim }]}
    />
  )
}

/**
 * Enter and exit animation for a bar that replaces something else in place - a
 * selection toolbar taking over from a summary strip, for example. It fades and
 * eases 14px down on the way in and back up on the way out, so neither swap is
 * a jump cut.
 *
 * The exit is much shorter than the entry. Entering, the bar is new
 * information and the user waits for it. Leaving, the user has already moved
 * on and wants what is underneath - and the thing beneath cannot appear until
 * the exit finishes, so every extra frame here is felt as lag.
 *
 * The parent must keep the bar mounted until `onExited` fires, otherwise the
 * exit never plays. Pass a stable `onExited`.
 */
export function SlideDownIn({
  style,
  active = true,
  onExited,
  children,
}: {
  style?: StyleProp<ViewStyle>
  active?: boolean
  onExited?: () => void
  children: ReactNode
}) {
  const anim = useRef(new Animated.Value(0)).current
  useToggleTiming(anim, active, {
    inMs: DUR.barIn,
    outMs: DUR.barOut,
    easeIn: EASE.out,
    // Ease-OUT on the way out, not ease-in. Ease-in holds the bar near full
    // opacity through the first half, and that stall is what reads as lag.
    // Ease-out spends the visible part of the motion up front and leaves a
    // soft tail, so the exit can last long enough to be seen without
    // feeling slow.
    easeOut: EASE.outSoft,
    onRest: (finished, on) => {
      if (finished && !on) onExited?.()
    },
  })

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                // Enough travel to register as movement. At -8 the exit read
                // as a flicker rather than the bar leaving.
                outputRange: [-14, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

/**
 * Fades children in and collapses their width away when inactive, so the
 * siblings beside them slide instead of snapping. Use this for an element
 * that appears and disappears inside a row - a checkmark next to a pill, for
 * example. The element stays mounted at zero width, so there is no unmount
 * jump at the end of the fade.
 *
 * `width` is the child's own width. `gap` is the parent's flex gap: the
 * animated box absorbs it and cancels it with a negative margin, because a
 * flex gap still applies to a zero-width child.
 *
 * Width is a layout property, so this animation cannot run on the UI thread.
 * Keep it to small, infrequent elements.
 */
export function CollapseIn({
  active,
  width,
  gap = 0,
  children,
}: {
  active: boolean
  width: number
  gap?: number
  children: ReactNode
}) {
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current
  useToggleTiming(anim, active, {
    inMs: DUR.collapseIn,
    outMs: DUR.collapseOut,
    easeIn: EASE.out,
    native: false, // width is a layout property
  })

  return (
    <Animated.View
      style={{
        opacity: anim,
        width: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, width + gap],
        }),
        marginLeft: -gap,
        overflow: "hidden",
        alignItems: "flex-end",
      }}
    >
      {children}
    </Animated.View>
  )
}
