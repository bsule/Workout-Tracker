import { useEffect, useRef, type ReactNode } from "react"
import {
  Alert,
  Pressable,
  StyleSheet,
  type AlertButton,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import type { Ionicons } from "@expo/vector-icons"

/**
 * The app's dropdown menus, as the system alert.
 *
 * ## How this got here
 *
 * These were UIMenus for a while, through a native module. The platform places
 * a UIMenu itself, and from a button in the navigation bar iOS 26 puts it
 * straight over the button that opened it - the overflow "..." disappears
 * under its own menu. There is no placement prop to fix that with, so they
 * became a hand-drawn card in the middle of the screen, where they cover
 * nothing the user just tapped. That module is gone from the dependencies; an
 * alert needs none.
 *
 * Centred was the right call; drawing it ourselves was not. `Alert.alert` is
 * centred too, and on iOS 26 the system draws it as a stack of pill buttons -
 * which is the look the card was imitating. So the placement stays and the
 * drawing goes back to the platform.
 *
 * Three things follow from that, and they are the whole reason this file is
 * still a file rather than a call to `Alert.alert` at each site:
 *
 * - **No dismiss timing.** The card had to defer `onSelect` past its own
 *   fade, or a store mutation would re-render the screen behind it and stall
 *   the animation. The alert is gone before `onPress` fires, so handlers run
 *   directly.
 * - **No armed backdrop.** The card had to ignore taps for one fade's length
 *   so the tap that opened it could not bleed through and close it again.
 * - **A narrower row.** An alert button is a title and nothing else. What the
 *   richer `MenuAction` carried is folded into that title below.
 *
 * `MenuAction` keeps its shape so call sites did not have to change.
 */

export type MenuAction = {
  /** Handed back to `onSelect`. */
  id: string
  title: string
  /** A second line under the title. Say why a row is disabled, or what it
   *  counts - never repeat the title. Folded into the button title in
   *  parentheses, since an alert button has no second line. */
  subtitle?: string
  /** Kept for source compatibility. An alert button cannot carry an icon, so
   *  this is ignored. */
  icon?: keyof typeof Ionicons.glyphMap
  /** Red title, for a row that destroys data. */
  destructive?: boolean
  /** An alert cannot grey a button out, so a disabled row is left off the
   *  alert and its `subtitle` is shown as the message instead - the "why"
   *  survives even though the row does not. */
  disabled?: boolean
  /** Left out entirely. */
  hidden?: boolean
  /** Marks the current choice, for a menu that picks one of a set. An alert
   *  has no checkmark, so the title is ticked instead. */
  selected?: boolean
}

function labelFor(a: MenuAction): string {
  const base = a.selected ? `✓ ${a.title}` : a.title
  return a.subtitle ? `${base} (${a.subtitle})` : base
}

/**
 * Present the menu. Returns immediately; `onSelect` fires later, or not at all
 * if the user cancels.
 */
function present(
  actions: MenuAction[],
  onSelect: (id: string) => void,
  title: string | undefined,
  onDismiss: () => void
) {
  const rows = actions.filter((a) => !a.hidden)
  const enabled = rows.filter((a) => !a.disabled)
  if (enabled.length === 0) {
    onDismiss()
    return
  }

  // A disabled row's subtitle is the only place that says why it is disabled,
  // and the row itself cannot be shown greyed. The message carries it instead.
  const why = rows
    .filter((a) => a.disabled && a.subtitle)
    .map((a) => `${a.title}: ${a.subtitle}`)
    .join("\n")

  const buttons: AlertButton[] = enabled.map((a) => ({
    text: labelFor(a),
    style: a.destructive ? "destructive" : "default",
    onPress: () => {
      onDismiss()
      onSelect(a.id)
    },
  }))
  // Last, so iOS puts it at the bottom of the stack.
  buttons.push({ text: "Cancel", style: "cancel", onPress: onDismiss })

  Alert.alert(title ?? "", why || undefined, buttons, {
    cancelable: true,
    onDismiss,
  })
}

/**
 * The menu on its own, for a caller that owns the open state - the set
 * logger's overflow menu, whose button lives in the native header while the
 * menu belongs to the screen.
 *
 * Renders nothing. It presents the alert when `visible` turns true and calls
 * `onClose` once the alert is gone, so the caller's flag tracks reality.
 */
export function MenuPopup({
  visible,
  onClose,
  actions,
  onSelect,
  title,
}: {
  visible: boolean
  onClose: () => void
  actions: MenuAction[]
  /** Receives the `id` of the chosen row. */
  onSelect: (id: string) => void
  /** Optional heading above the rows. */
  title?: string
}) {
  // The latest props, read at press time rather than captured when the alert
  // was presented. An alert is a native window: it outlives the render that
  // opened it, and the actions behind it can change while it is up.
  const live = useRef({ actions, onSelect, onClose })
  live.current = { actions, onSelect, onClose }

  const shown = useRef(false)
  useEffect(() => {
    if (!visible) {
      shown.current = false
      return
    }
    // Guard against a re-render while the alert is already up: presenting a
    // second one would stack two windows over each other.
    if (shown.current) return
    shown.current = true
    present(
      live.current.actions,
      (id) => live.current.onSelect(id),
      title,
      () => {
        shown.current = false
        live.current.onClose()
      }
    )
  }, [visible, title])

  return null
}

/**
 * A trigger and its menu. The trigger is whatever you pass as children; a tap
 * on it presents the alert.
 */
export function MenuButton({
  actions,
  onSelect,
  title,
  style,
  children,
}: {
  actions: MenuAction[]
  onSelect: (id: string) => void
  title?: string
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  // No open state to hold: the alert is a native window, so there is nothing
  // in this tree to keep in sync with it.
  const open = useRef(false)
  return (
    <Pressable
      onPress={() => {
        if (open.current) return
        open.current = true
        present(actions, onSelect, title, () => {
          open.current = false
        })
      }}
      unstable_pressDelay={0}
      style={({ pressed }) => [style, pressed && styles.triggerPressed]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  triggerPressed: { opacity: 0.55 },
})
