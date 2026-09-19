import { useEffect, useState, type ReactNode } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { OverlayCard, overlayCardStyles } from "./OverlayCard"
import { ANIM_SLACK_MS, DUR, deferPastAnimation, usePresence } from "../anim"
import { theme } from "../theme/theme"

/**
 * The app's dropdown menus, as a centred card.
 *
 * These were system menus for a while (`@react-native-menu/menu`, a UIMenu on
 * iOS). The platform places a UIMenu itself, and from a button in the
 * navigation bar iOS 26 puts it straight over the button that opened it - the
 * overflow "..." disappears under its own menu. There is no placement prop to
 * fix that with, so the menus are drawn here instead, in the middle of the
 * screen, where they cover nothing the user just tapped.
 *
 * It is the same shell as every other popup in the app: `usePresence` for the
 * fade, `OverlayCard` for the backdrop and the card. Two things the system
 * menu did for free come back as code:
 *
 * - **Dismiss timing.** A store mutation run during the fade re-renders the
 *   screen behind the card and stalls it. `onSelect` is therefore deferred
 *   past the fade, once, here - not at each call site.
 * - **The checkmark.** `selected` draws it, in place of UIMenu's `state`.
 *
 * Icons are Ionicons names, not SF Symbols, because these rows are ours.
 */

export type MenuAction = {
  /** Handed back to `onSelect`. */
  id: string
  title: string
  /** A second line under the title. Say why a row is disabled, or what it
   *  counts - never repeat the title. */
  subtitle?: string
  icon?: keyof typeof Ionicons.glyphMap
  /** Red title, for a row that destroys data. */
  destructive?: boolean
  /** Greyed and inert. Pair it with a `subtitle` that says why. */
  disabled?: boolean
  /** Left out of the card entirely. */
  hidden?: boolean
  /** Marks the current choice, for a menu that picks one of a set. */
  selected?: boolean
}

const FADE_MS = DUR.fadeFast

/**
 * The card on its own, for a caller that owns the open state - the set
 * logger's overflow menu, whose button lives in the native header while the
 * card belongs in the screen.
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
  /** Receives the `id` of the chosen row, after the fade-out. */
  onSelect: (id: string) => void
  /** Optional heading above the rows. */
  title?: string
}) {
  const { mounted, opacity } = usePresence(visible, { inMs: FADE_MS })

  // Disarm the backdrop during the entrance so the tap that opened the menu
  // cannot bleed through and close it again.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    const t = setTimeout(() => setArmed(true), FADE_MS + ANIM_SLACK_MS)
    return () => clearTimeout(t)
  }, [visible])

  if (!mounted) return null

  const rows = actions.filter((a) => !a.hidden)

  function choose(action: MenuAction) {
    onClose()
    deferPastAnimation(() => onSelect(action.id), FADE_MS)
  }

  return (
    <OverlayCard
      opacity={opacity}
      visible={visible}
      onBackdropPress={armed ? onClose : undefined}
      align="center"
      hostInModal
      style={styles.card}
    >
      <ScrollView
        style={overlayCardStyles.scroll}
        contentContainerStyle={styles.content}
      >
        {title != null && <Text style={styles.title}>{title}</Text>}
        {rows.map((a, i) => (
          <MenuRow
            key={a.id}
            action={a}
            last={i === rows.length - 1}
            onPress={() => choose(a)}
          />
        ))}
      </ScrollView>
    </OverlayCard>
  )
}

/**
 * A trigger and its menu. The trigger is whatever you pass as children; a tap
 * on it opens the card.
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
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        unstable_pressDelay={0}
        style={({ pressed }) => [style, pressed && styles.triggerPressed]}
      >
        {children}
      </Pressable>
      <MenuPopup
        visible={open}
        onClose={() => setOpen(false)}
        actions={actions}
        onSelect={onSelect}
        title={title}
      />
    </>
  )
}

function MenuRow({
  action,
  last,
  onPress,
}: {
  action: MenuAction
  last: boolean
  onPress: () => void
}) {
  const color = action.disabled
    ? theme.colors.muted
    : action.destructive
      ? theme.colors.destructive
      : theme.colors.foreground

  return (
    <Pressable
      onPress={onPress}
      disabled={action.disabled}
      unstable_pressDelay={0}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowDivider,
        pressed && !action.disabled && styles.rowPressed,
      ]}
    >
      {action.icon != null && (
        <Ionicons name={action.icon} size={18} color={color} />
      )}
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color }]} numberOfLines={2}>
          {action.title}
        </Text>
        {action.subtitle != null && (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {action.subtitle}
          </Text>
        )}
      </View>
      {action.selected === true && (
        <Ionicons name="checkmark" size={18} color={theme.colors.secondary} />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The rows run edge to edge, so the card keeps no padding of its own and
  // each row carries it instead. A divider that stopped short of the card's
  // edge would read as a gap in the list.
  card: { padding: 0, gap: 0 },
  content: { paddingVertical: theme.spacing[1] },
  // Smaller and quieter than `overlayCardStyles.title`: this is a menu's
  // heading ("Sort by"), not a popup's subject.
  title: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.muted,
    fontWeight: "700",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: theme.fontSize.base, fontWeight: "600" },
  rowSubtitle: { color: theme.colors.muted, fontSize: theme.fontSize.xs },
  triggerPressed: { opacity: 0.6 },
})
