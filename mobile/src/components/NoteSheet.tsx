import { useEffect, useRef } from "react"
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "./Button"
import { OverlayCard, overlayCardStyles } from "./OverlayCard"
import { DUR, deferPastAnimation, usePresence } from "../anim"
import { theme } from "../theme/theme"

export const NOTE_FADE_MS = DUR.fade

/**
 * The note popup used across the app: a centered card that reads a note first
 * and edits it on demand.
 *
 * Two modes. "view" shows the saved text read-only behind a Close/Edit pair -
 * the note is usually the thing you want to read, and dropping straight into a
 * keyboard hid it behind the input. "edit" is the input itself, with
 * Cancel/Save. Callers that have nothing to read - an empty note, or an "add
 * note" menu item - open at "edit" and skip the extra tap.
 *
 * Not a react-native-modal: its keyboard handling stuttered on close, and
 * mutations during the exit animation made the card appear to double-animate.
 * This runs one native-driven fade (see usePresence) and leaves the save to
 * the caller, which defers it past the fade.
 *
 * The set logger carried a second copy of this component, styles included, and
 * the two had not drifted. There is one now.
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
  const { mounted, opacity } = usePresence(visible, { inMs: NOTE_FADE_MS })

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
    deferPastAnimation(save, NOTE_FADE_MS)
  }

  if (!mounted) return null

  const viewing = mode === "view"

  return (
    <OverlayCard
      opacity={opacity}
      visible={visible}
      onBackdropPress={onClose}
      // Editing has a draft to lose, so the card takes the touch. Viewing has
      // a scroll area instead, which a responder here would break.
      claimTouches={!viewing}
    >
      <Text style={overlayCardStyles.title}>{title}</Text>
      {viewing ? (
        <ScrollView
          style={overlayCardStyles.scroll}
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
          style={[overlayCardStyles.input, styles.noteInput]}
        />
      )}
      <View style={overlayCardStyles.actions}>
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
    </OverlayCard>
  )
}

const styles = StyleSheet.create({
  viewText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
  },
  // Layered over overlayCardStyles.input: a note is multi-line, so the field
  // is taller than the shared one and grows to a limit.
  noteInput: {
    fontSize: theme.fontSize.sm,
    height: 96,
    maxHeight: 160,
    textAlignVertical: "top",
  },
})
