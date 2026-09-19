import { useEffect, useRef, type ReactNode } from "react"
import {
  Animated,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { DUR, EASE } from "../anim"

/** How long a newly written note takes to appear. */
export const NOTE_REVEAL_MS = DUR.noteReveal

/**
 * Fades a note line in when the user writes one.
 *
 * Render it unconditionally and pass the note text: it returns nothing while
 * the note is empty. That is what lets it tell a note that was already there
 * when the screen opened from one the user just wrote. The first case renders
 * statically, because the row or card carries its own entrance animation and
 * a second fade on top of it reads as lag. The second case fades and settles
 * down into place.
 *
 * Opacity and translateY only, both on the native driver. The container's
 * height change belongs to NOTE_SHIFT_ANIM in ../anim, which the caller
 * configures right before the mutation that writes the note.
 */
export function NoteReveal({
  note,
  children,
  style,
}: {
  note: string
  children: ReactNode
  /** Flex properties the wrapped content used to carry itself, when this
   *  extra view would otherwise absorb them from its parent's layout. */
  style?: StyleProp<ViewStyle>
}) {
  const hasNote = !!note.trim()
  const shownAtMount = useRef(hasNote).current
  const anim = useRef(new Animated.Value(shownAtMount ? 1 : 0)).current
  // True once this note has played its reveal, so editing the text of a note
  // that is already on screen does not replay it.
  const revealed = useRef(shownAtMount)

  useEffect(() => {
    if (!hasNote) {
      // Cleared. Re-arm, so a note written later fades in like a new one.
      revealed.current = false
      anim.setValue(0)
      return
    }
    if (revealed.current) return
    revealed.current = true
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: NOTE_REVEAL_MS,
      easing: EASE.out,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [hasNote, anim])

  if (!hasNote) return null

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {
              // Settles down into the space the container just opened, rather
              // than appearing in a slot that is already there.
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-4, 0],
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
