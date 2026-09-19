import { useEffect, useState, type ReactNode } from "react"
import { ScrollView, StyleSheet, Text } from "react-native"
import { OverlayCard, overlayCardStyles } from "./OverlayCard"
import { ANIM_SLACK_MS, DUR, usePresence } from "../anim"
import { theme } from "../theme/theme"

interface Props {
  visible: boolean
  title?: string
  onClose: () => void
  children: ReactNode
}

/**
 * A titled card with scrollable content: the form popups on Settings and
 * Categories, and the set logger's planned-set actions.
 *
 * This used to wrap `react-native-modal`, whose card animation and backdrop
 * transition are two separate timings. Every popup elsewhere in the app had
 * already moved off it, because two timings over the same pixels is what reads
 * as a flicker or a double animation on open and close. It now runs the same
 * single `usePresence` fade as the rest, hosted in a core Modal so a popup
 * opened from inside a ScrollView still escapes it.
 *
 * The three call sites all used the default fade, so the old `animationType`
 * prop ("fade" | "slide" | "zoom") is gone rather than reimplemented, as is
 * `onShow` - every one of them uses `autoFocus` on its input instead.
 */
export function PopupModal({ visible, title, onClose, children }: Props) {
  const { mounted, opacity } = usePresence(visible, { inMs: DUR.fade })

  // Disarm the backdrop during the entrance so the tap that opened the popup
  // cannot bleed through and immediately close it.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    const t = setTimeout(() => setArmed(true), DUR.fade + ANIM_SLACK_MS)
    return () => clearTimeout(t)
  }, [visible])

  if (!mounted) return null

  return (
    <OverlayCard
      opacity={opacity}
      visible={visible}
      onBackdropPress={armed ? onClose : undefined}
      hostInModal
      // These cards hold forms with drafts in them, so a stray tap beside an
      // input must not reach the backdrop.
      claimTouches
      style={styles.card}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={overlayCardStyles.scroll}
        contentContainerStyle={styles.content}
      >
        {title != null && <Text style={overlayCardStyles.title}>{title}</Text>}
        {children}
      </ScrollView>
    </OverlayCard>
  )
}

const styles = StyleSheet.create({
  // The card's own padding moves to the scroll content, so a long form scrolls
  // under the padding rather than being clipped by it.
  card: { padding: 0, gap: 0 },
  content: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
})
