import type { ReactNode } from "react"
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { theme } from "../theme/theme"

/**
 * The shell every popup in this app is built from: a dimmed backdrop that
 * dismisses on tap, and a card on top of it.
 *
 * Five popups had grown their own copy of this - the note sheet, a second copy
 * of the note sheet inside the set logger, the gym picker, the record-day
 * popup, and PopupModal - each with the same overlay colour, the same card
 * border, and its own fade. The fade now comes from `usePresence`; this is the
 * markup and the styles.
 *
 * ## Two rules it encodes
 *
 * **The backdrop and the card are siblings, never nested.** A card nested
 * inside the backdrop Pressable needs two taps to dismiss, because the outer
 * Pressable claims the first one. Every popup here hit that at least once.
 *
 * **The card does not claim touches unless it has to.** A JS responder on the
 * card blocks the native scroll gesture of any ScrollView inside it, so a long
 * note cannot be scrolled. `claimTouches` turns the claim on for a card with a
 * draft to lose - a stray tap beside a text input must not throw the text
 * away. Read-only cards leave it off and accept that a tap on the card's
 * padding dismisses, which discards nothing.
 */
export function OverlayCard({
  opacity,
  visible,
  onBackdropPress,
  align = "top",
  claimTouches = false,
  hostInModal = false,
  style,
  children,
}: {
  /** From `usePresence`. Drives the whole overlay, backdrop included. */
  opacity: Animated.Value
  /** Gates touches. False during the fade-out, so a dying popup is inert. */
  visible: boolean
  onBackdropPress?: () => void
  /**
   * "top" pins the card near the top of the screen, which keeps it visible
   * whether or not a keyboard is up - these popups have no keyboard avoidance
   * of their own, so a centred card with an input would be covered. "center"
   * is for a read-only card with no input.
   */
  align?: "top" | "center"
  /** See the note above on responders and scrolling. */
  claimTouches?: boolean
  /**
   * Host the overlay in a native Modal so it escapes the parent hierarchy.
   * Needed for a popup rendered inside a ScrollView, which would otherwise be
   * clipped by it. The Modal's own animation is off - the fade is ours.
   */
  hostInModal?: boolean
  /** Extra style for the card. */
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const body = (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        align === "top" ? styles.overlayTop : styles.overlayCenter,
        { opacity },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} />
      <Animated.View
        style={[
          align === "top" ? styles.cardTop : styles.cardCenter,
          style,
        ]}
        pointerEvents={claimTouches ? "auto" : "box-none"}
        onStartShouldSetResponder={claimTouches ? yes : undefined}
      >
        {children}
      </Animated.View>
    </Animated.View>
  )

  if (!hostInModal) return body

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={onBackdropPress}
    >
      {body}
    </Modal>
  )
}

function yes() {
  return true
}

/** The card's own title row style, exported so callers share one heading. */
export const overlayCardStyles = StyleSheet.create({
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  /** A row of equal-width buttons at the foot of a card. */
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  /** A text input's chrome inside a card. Callers set their own font size. */
  input: {
    color: theme.colors.foreground,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  /** A scroll area inside a card: bounded by the card, never growing it. */
  scroll: { flexGrow: 0, flexShrink: 1 },
})

const styles = StyleSheet.create({
  overlayTop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 80,
    paddingHorizontal: theme.spacing[4],
    // Above the screen's own content when this is not hosted in a Modal.
    zIndex: 50,
    elevation: 50,
  },
  overlayCenter: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[5],
  },
  cardTop: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    // The card is what bounds long content, and any scroll area shrinks inside
    // it. A maxHeight on the scroll area alone leaves the card free to grow.
    maxHeight: "70%",
  },
  cardCenter: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "70%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
})
