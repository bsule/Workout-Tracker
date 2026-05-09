import { useEffect, useState, type ReactNode } from "react"
import { ScrollView, StyleSheet, Text } from "react-native"
import Modal from "react-native-modal"
import { theme } from "../theme/theme"

interface Props {
  visible: boolean
  title?: string
  onClose: () => void
  children: ReactNode
  animationType?: "fade" | "slide" | "zoom"
  // Fires after the entrance animation completes — useful for focusing an
  // input only once the modal is actually on-screen.
  onShow?: () => void
}

const ANIM_IN = { fade: "fadeIn", slide: "slideInUp", zoom: "zoomIn" } as const
const ANIM_OUT = { fade: "fadeOut", slide: "slideOutDown", zoom: "zoomOut" } as const

export function PopupModal({
  visible,
  title,
  onClose,
  children,
  animationType = "fade",
  onShow,
}: Props) {
  // Disarm the backdrop press during the entrance animation so the tap
  // that opened the modal can't bleed through and immediately close it.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    const t = setTimeout(() => setArmed(true), 260)
    return () => clearTimeout(t)
  }, [visible])

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={armed ? onClose : undefined}
      onBackButtonPress={onClose}
      onModalShow={onShow}
      animationIn={ANIM_IN[animationType]}
      animationOut={ANIM_OUT[animationType]}
      animationInTiming={220}
      animationOutTiming={200}
      backdropTransitionInTiming={200}
      backdropTransitionOutTiming={150}
      backdropOpacity={0.55}
      useNativeDriver
      useNativeDriverForBackdrop
      // Pinned to the top of the screen instead of centered. With no
      // avoidKeyboard / keyboard listener, the modal never moves on its
      // own, so the close animation can't fight a reposition. Sitting near
      // the top keeps it visible regardless of whether the keyboard is up.
      style={styles.modal}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={styles.cardScroll}
        contentContainerStyle={styles.card}
      >
        {title != null && <Text style={styles.title}>{title}</Text>}
        {children}
      </ScrollView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modal: {
    margin: 0,
    paddingTop: 80,
    paddingHorizontal: theme.spacing[4],
    justifyContent: "flex-start",
  },
  cardScroll: {
    flexGrow: 0,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  card: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
})
