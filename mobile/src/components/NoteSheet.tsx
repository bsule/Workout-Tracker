import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "./Button"
import { theme } from "../theme/theme"

export const NOTE_FADE_MS = 180

/**
 * The note popup used across the app: a centered card that reads a note first
 * and edits it on demand.
 *
 * Two modes. "view" shows the saved text read-only behind a Close/Edit pair —
 * the note is usually the thing you want to read, and dropping straight into a
 * keyboard hid it behind the input. "edit" is the input itself, with
 * Cancel/Save. Callers that have nothing to read — an empty note, or an "add
 * note" menu item — open at "edit" and skip the extra tap.
 *
 * Not a react-native-modal: its keyboard handling stuttered on close, and
 * mutations during the exit animation made the card appear to double-animate.
 * This runs one native-driven fade and leaves the save to the caller, which
 * defers it past the fade.
 */
export function NoteSheet({
  visible,
  mode,
  title,
  placeholder,
  original,
  draft,
  onChangeDraft,
  onEdit,
  onClose,
  onSave,
}: {
  visible: boolean
  mode: "view" | "edit"
  title: string
  placeholder: string
  original: string
  draft: string
  onChangeDraft: (s: string) => void
  onEdit: () => void
  onClose: () => void
  onSave: () => void
}) {
  const dirty = draft.trim() !== (original ?? "").trim()
  const inputRef = useRef<TextInput | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1,
        duration: NOTE_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: NOTE_FADE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [visible, opacity])

  // Focus after one frame so the keyboard rises against an already visible
  // card (no focus-during-fade-in flash). Keyed on `mode` too, so tapping Edit
  // in a view-first sheet raises the keyboard the same way.
  useEffect(() => {
    if (!visible || mode !== "edit") return
    const f = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(f)
  }, [visible, mode])

  function handleSave() {
    if (!dirty) return
    // Close first; the caller's mutation is deferred past the fade so the
    // screen behind doesn't re-render mid-animation.
    const save = onSave
    Keyboard.dismiss()
    onClose()
    setTimeout(save, NOTE_FADE_MS + 40)
  }

  if (!mounted) return null

  const viewing = mode === "view"

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.overlay, { opacity }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      {/* The card only claims taps while editing. A JS responder claimed on an
          ancestor blocks the native scroll gesture of the ScrollView below, so
          in view mode the card must stay out of the way (box-none) or a long
          note cannot be scrolled; the cost there is that a tap on the card's
          padding reaches the backdrop and closes the sheet, which discards
          nothing. Editing has no scroll area and a draft to lose, so the claim
          comes back: a stray tap beside the input must not throw the text
          away. */}
      <View
        style={styles.card}
        pointerEvents={viewing ? "box-none" : "auto"}
        onStartShouldSetResponder={() => !viewing}
      >
        <Text style={styles.title}>{title}</Text>
        {viewing ? (
          <ScrollView
            style={styles.viewScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.viewText}>{(original || draft).trim()}</Text>
          </ScrollView>
        ) : (
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.muted}
            multiline
            style={styles.input}
          />
        )}
        <View style={styles.actions}>
          {viewing ? (
            <>
              <Button
                label="Close"
                variant="secondary"
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <Button label="Edit" onPress={onEdit} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <Button
                label="Save"
                onPress={handleSave}
                disabled={!dirty}
                style={{ flex: 1 }}
              />
            </>
          )}
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 80,
    paddingHorizontal: theme.spacing[4],
    zIndex: 50,
    elevation: 50,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    // The card is what bounds a long note, and the scroll area shrinks inside
    // it. A maxHeight on the scroll area alone left the card free to grow.
    maxHeight: "70%",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  viewScroll: { flexGrow: 0, flexShrink: 1 },
  viewText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    height: 96,
    maxHeight: 160,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
})
