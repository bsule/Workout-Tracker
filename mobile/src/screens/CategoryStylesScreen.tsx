import { useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import type { Category } from "@lift/core"
import { Button } from "../components/Button"
import { PopupModal } from "../components/PopupModal"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"
import {
  COLOR_PALETTE,
  useCategoryStyles,
} from "../categories/CategoryStylesProvider"

type EditorState =
  | { mode: "edit"; category: Category }
  | { mode: "create" }

export function CategoryStylesScreen() {
  const {
    categories,
    labels,
    colors,
    isDefault,
    setLabel,
    setColor,
    resetCategory,
    addCategory,
    removeCategory,
  } = useCategoryStyles()

  const [editor, setEditor] = useState<EditorState | null>(null)

  function openCreate() {
    setEditor({ mode: "create" })
  }
  function openEdit(c: Category) {
    setEditor({ mode: "edit", category: c })
  }
  function closeEditor() {
    setEditor(null)
  }

  function commitEdit(c: Category, label: string, color: string) {
    setLabel(c, label)
    setColor(c, color)
    closeEditor()
  }
  function commitCreate(label: string, color: string) {
    const slug = addCategory(label, color)
    if (!slug) {
      Alert.alert("Could not add category", "Please choose a different name.")
      return
    }
    closeEditor()
  }
  function commitDelete(c: Category) {
    Alert.alert(
      "Delete category?",
      "Existing exercises that used this category will keep the slug but lose its color and label.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            removeCategory(c)
            closeEditor()
          },
        },
      ]
    )
  }

  return (
    <StaticSafeAreaView>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.wrap}
      >
        <Text style={styles.subtitle}>Saved on this device.</Text>

        <View style={styles.card}>
          {categories.map((c) => (
            <Pressable
              key={c}
              onPress={() => openEdit(c)}
              style={({ pressed }) => [
                styles.row,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View
                style={[
                  styles.swatch,
                  {
                    backgroundColor:
                      colors[c] ?? theme.colors.cat[c] ?? theme.colors.muted,
                  },
                ]}
              />
              <Text style={styles.rowLabel} numberOfLines={1}>
                {labels[c] ?? c}
              </Text>
              {!isDefault(c) && (
                <Text style={styles.rowBadge}>CUSTOM</Text>
              )}
              <Ionicons
                name="chevron-forward"
                size={18}
                color={theme.colors.muted}
              />
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: theme.spacing[4] }}>
          <Button label="+ Add category" onPress={openCreate} />
        </View>
      </ScrollView>

      <CategoryEditorModal
        visible={editor != null}
        editor={editor}
        currentLabel={
          editor?.mode === "edit" ? labels[editor.category] ?? editor.category : ""
        }
        currentColor={
          editor?.mode === "edit"
            ? colors[editor.category] ??
              theme.colors.cat[editor.category] ??
              theme.colors.muted
            : COLOR_PALETTE[0]
        }
        canDelete={editor?.mode === "edit" && !isDefault(editor.category)}
        canReset={
          editor?.mode === "edit" &&
          isDefault(editor.category) &&
          (!!labels[editor.category] && labels[editor.category] !== editor.category
            ? colors[editor.category] != null ||
              labels[editor.category] !==
                DEFAULT_LABEL_FALLBACK[editor.category]
            : colors[editor.category] != null)
        }
        onCancel={closeEditor}
        onSave={(label, color) => {
          if (editor?.mode === "create") commitCreate(label, color)
          else if (editor?.mode === "edit") commitEdit(editor.category, label, color)
        }}
        onReset={() => {
          if (editor?.mode === "edit") {
            resetCategory(editor.category)
            closeEditor()
          }
        }}
        onDelete={() => {
          if (editor?.mode === "edit") commitDelete(editor.category)
        }}
      />
    </StaticSafeAreaView>
  )
}

// Local copy of the built-in defaults — used only for the "is it different
// from default" check in the reset-button visibility logic. The provider
// owns the actual labels, but this avoids re-exporting an internal map.
const DEFAULT_LABEL_FALLBACK: Record<string, string> = {
  abs: "Abs",
  back: "Back",
  biceps: "Biceps",
  cardio: "Cardio",
  chest: "Chest",
  legs: "Legs",
  shoulders: "Shoulders",
  triceps: "Triceps",
}

function CategoryEditorModal({
  visible,
  editor,
  currentLabel,
  currentColor,
  canDelete,
  canReset,
  onCancel,
  onSave,
  onReset,
  onDelete,
}: {
  visible: boolean
  editor: EditorState | null
  currentLabel: string
  currentColor: string
  canDelete: boolean
  canReset: boolean
  onCancel: () => void
  onSave: (label: string, color: string) => void
  onReset: () => void
  onDelete: () => void
}) {
  const [label, setLabelDraft] = useState("")
  const [color, setColorDraft] = useState(COLOR_PALETTE[0])

  // Reseed local state when the editor opens for a different target.
  // useEffect-not-needed pattern: derive from props via render-time check
  // would cause stale state on prop change, so explicit effect.
  // Using useState with initial value, plus a manual reseed when `visible`
  // flips to true.
  // (The pattern matches the NoteEditorSheet in SetLoggerScreen.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useReseedOnOpen(visible, () => {
    setLabelDraft(currentLabel)
    setColorDraft(currentColor)
  })

  const title = editor?.mode === "create" ? "New category" : "Edit category"
  const canSave = label.trim().length > 0
  return (
    <PopupModal visible={visible} title={title} onClose={onCancel}>
      <TextInput
        value={label}
        onChangeText={setLabelDraft}
        placeholder="Label"
        placeholderTextColor={theme.colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        autoFocus
        style={styles.modalInput}
      />
      <Text style={styles.paletteLabel}>Color</Text>
      <View style={styles.palette}>
        {COLOR_PALETTE.map((c) => {
          const selected = c.toLowerCase() === color.toLowerCase()
          return (
            <Pressable
              key={c}
              onPress={() => setColorDraft(c)}
              style={[
                styles.paletteSwatch,
                { backgroundColor: c },
                selected && styles.paletteSwatchSelected,
              ]}
            />
          )
        })}
      </View>

      <View style={styles.modalActions}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onCancel}
          style={{ flex: 1 }}
        />
        <Button
          label="Save"
          onPress={() => onSave(label, color)}
          disabled={!canSave}
          style={{ flex: 1 }}
        />
      </View>
      {(canReset || canDelete) && (
        <View style={styles.modalSecondaryActions}>
          {canReset && (
            <Button
              label="Reset to default"
              variant="secondary"
              onPress={onReset}
              style={{ flex: 1 }}
            />
          )}
          {canDelete && (
            <Button
              label="Delete"
              variant="destructive"
              onPress={onDelete}
              style={{ flex: 1 }}
            />
          )}
        </View>
      )}
    </PopupModal>
  )
}

// Tiny helper for "run effect when `visible` toggles to true" without
// pulling another react import. Keeps the editor's local state in sync
// with whichever target opened it.
import { useEffect, useRef } from "react"
function useReseedOnOpen(visible: boolean, fn: () => void) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (visible) fnRef.current()
  }, [visible])
}

const styles = StyleSheet.create({
  wrap: { padding: theme.spacing[4], gap: theme.spacing[3] },
  subtitle: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  card: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  rowLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  rowBadge: {
    color: theme.colors.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  paletteLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  palette: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  paletteSwatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  paletteSwatchSelected: {
    borderWidth: 3,
    borderColor: theme.colors.foreground,
  },
  modalActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  modalSecondaryActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
})
