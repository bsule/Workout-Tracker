"use client"

import { useState } from "react"
import { ChevronRight, Plus } from "lucide-react"
import {
  COLOR_PALETTE,
  useCategoryStyles,
} from "@/components/categories/CategoryStylesProvider"
import { PopupModal, modalInputClass } from "@/components/settings/PopupModal"
import { SettingsGroup, SettingsPage } from "@/components/settings/SettingRows"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { categoryVar, cn } from "@/lib/utils"
import type { Category } from "@/types"

type EditorState = { mode: "edit"; category: Category } | { mode: "create" }

export default function CategoryStylesPage() {
  const {
    categories,
    labels,
    colors,
    isDefault,
    canReset,
    setLabel,
    setColor,
    resetCategory,
    addCategory,
    removeCategory,
  } = useCategoryStyles()
  const confirm = useConfirm()

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [label, setLabelDraft] = useState("")
  // Undefined while a built-in still shows its theme color.
  const [color, setColorDraft] = useState<string | undefined>(COLOR_PALETTE[0])
  const [error, setError] = useState<string | null>(null)

  function openCreate() {
    setEditor({ mode: "create" })
    setLabelDraft("")
    setColorDraft(COLOR_PALETTE[0])
    setError(null)
  }
  function openEdit(c: Category) {
    setEditor({ mode: "edit", category: c })
    setLabelDraft(labels[c] ?? c)
    setColorDraft(colors[c])
    setError(null)
  }
  function closeEditor() {
    setEditor(null)
  }

  function save() {
    if (!editor || !label.trim()) return
    if (editor.mode === "create") {
      const slug = addCategory(label, color ?? COLOR_PALETTE[0])
      if (!slug) {
        setError("Could not add category. Please choose a different name.")
        return
      }
    } else {
      setLabel(editor.category, label)
      if (color) setColor(editor.category, color)
    }
    closeEditor()
  }

  async function remove(c: Category) {
    const ok = await confirm({
      title: "Delete category?",
      message:
        "Existing exercises that used this category will keep the slug but lose its color and label.",
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    removeCategory(c)
    closeEditor()
  }

  const editing = editor?.mode === "edit" ? editor.category : null
  const showReset = editing != null && canReset(editing)
  const showDelete = editing != null && !isDefault(editing)

  return (
    <SettingsPage title="Categories" subtitle="Saved on this device.">
      <SettingsGroup>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => openEdit(c)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[.04]"
          >
            <span
              className="size-6 shrink-0 rounded-full"
              style={{ backgroundColor: colors[c] ?? categoryVar(c) }}
            />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {labels[c] ?? c}
            </span>
            {!isDefault(c) && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.12em] text-muted-foreground">
                CUSTOM
              </span>
            )}
            <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
          </button>
        ))}
      </SettingsGroup>

      <Button size="lg" className="mt-4" onClick={openCreate}>
        <Plus className="size-4" />
        Add category
      </Button>

      <PopupModal
        open={editor != null}
        title={editor?.mode === "create" ? "New category" : "Edit category"}
        onClose={closeEditor}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <input
            value={label}
            onChange={(e) => {
              setLabelDraft(e.target.value)
              setError(null)
            }}
            placeholder="Label"
            autoFocus
            autoCorrect="off"
            className={modalInputClass}
          />
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Color
          </p>
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((hex) => {
              const selected = color?.toLowerCase() === hex.toLowerCase()
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColorDraft(hex)}
                  aria-label={`Color ${hex}`}
                  aria-pressed={selected}
                  className={cn(
                    "size-9 rounded-lg transition-transform hover:scale-105",
                    selected && "border-[3px] border-foreground"
                  )}
                  style={{ backgroundColor: hex }}
                />
              )
            })}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={closeEditor}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={!label.trim()}>
              Save
            </Button>
          </div>
          {(showReset || showDelete) && (
            <div className="mt-1 flex gap-3">
              {showReset && editing && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    resetCategory(editing)
                    closeEditor()
                  }}
                >
                  Reset to default
                </Button>
              )}
              {showDelete && editing && (
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="flex-1"
                  onClick={() => void remove(editing)}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </form>
      </PopupModal>
    </SettingsPage>
  )
}
