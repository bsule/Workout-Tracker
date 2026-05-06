"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, Pencil, RotateCcw, Check, Plus, Trash2, X } from "lucide-react"
import { localApi as api } from "@/lib/store"
import { useAuth } from "@/components/auth/AuthProvider"
import { type Category } from "@/types"
import { categoryVar, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  COLOR_PALETTE,
  useCategoryStyles,
} from "@/components/categories/CategoryStylesProvider"

export default function NewExercisePage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const {
    categories,
    labels,
    colors,
    setLabel,
    setColor,
    resetCategory,
    isDefault,
    addCategory,
    removeCategory,
  } = useCategoryStyles()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<Category>("chest")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [draftLabel, setDraftLabel] = useState("")
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(COLOR_PALETTE[0])

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  // If the selected category gets removed, fall back to the first available.
  useEffect(() => {
    if (!categories.includes(category) && categories.length > 0) {
      setCategory(categories[0])
    }
  }, [categories, category])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Name is required.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createExercise({ name: name.trim(), category })
      router.push("/exercises")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create")
      setBusy(false)
    }
  }

  function openEditor(c: Category) {
    setEditing(c)
    setDraftLabel(labels[c])
    setAdding(false)
  }

  function commitLabel() {
    if (editing) setLabel(editing, draftLabel)
  }

  function exitEditMode() {
    commitLabel()
    setEditing(null)
    setAdding(false)
    setEditMode(false)
  }

  function startAdd() {
    commitLabel()
    setEditing(null)
    setNewName("")
    setNewColor(COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)])
    setAdding(true)
  }

  function commitAdd() {
    const slug = addCategory(newName, newColor)
    if (slug) {
      setCategory(slug)
      setAdding(false)
      setNewName("")
    }
  }

  function handleRemove(c: Category) {
    if (isDefault(c)) return
    removeCategory(c)
    if (editing === c) setEditing(null)
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:py-10 space-y-6">
      <Link
        href="/exercises"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" />
        Exercises
      </Link>

      <h1 className="text-xl font-bold tracking-tight">New Exercise</h1>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Category</label>
            <button
              type="button"
              onClick={() => (editMode ? exitEditMode() : setEditMode(true))}
              aria-label={editMode ? "Done editing categories" : "Edit categories"}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              {editMode ? (
                <>
                  <Check className="size-3" />
                  Done
                </>
              ) : (
                <>
                  <Pencil className="size-3" />
                  Edit
                </>
              )}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {categories.map((c) => {
              const active = c === category
              const isEditingThis = editing === c
              const removable = editMode && !isDefault(c)
              return (
                <div key={c} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (editMode) {
                        commitLabel()
                        openEditor(c)
                      } else {
                        setCategory(c)
                      }
                    }}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium",
                      editMode
                        ? isEditingThis
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-white/10 bg-white/[.02] hover:bg-white/5"
                        : active
                        ? "border-white/30 bg-white/10 text-foreground"
                        : "border-white/10 bg-white/[.02] hover:bg-white/5"
                    )}
                  >
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: categoryVar(c) }}
                    />
                    <span className="truncate">{labels[c]}</span>
                  </button>
                  {removable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(c)
                      }}
                      aria-label={`Delete ${labels[c]}`}
                      className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-white/15 bg-background text-muted-foreground hover:text-destructive hover:bg-white/10"
                    >
                      <X className="size-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
            {editMode && !adding && (
              <button
                type="button"
                onClick={startAdd}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/20 bg-white/[.02] px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground"
              >
                <Plus className="size-3" />
                Add
              </button>
            )}
          </div>
        </div>

        {editMode && adding && (
          <NewCategoryForm
            label={newName}
            onLabelChange={setNewName}
            color={newColor}
            onColorPick={setNewColor}
            onCancel={() => setAdding(false)}
            onSubmit={commitAdd}
          />
        )}

        {editMode && editing && !adding && (
          <CategoryEditor
            category={editing}
            label={draftLabel}
            onLabelChange={setDraftLabel}
            onLabelBlur={commitLabel}
            currentColor={colors[editing]}
            onColorPick={(hex) => setColor(editing, hex)}
            canReset={isDefault(editing)}
            canDelete={!isDefault(editing)}
            onReset={() => {
              resetCategory(editing)
              setDraftLabel(labels[editing])
            }}
            onDelete={() => handleRemove(editing)}
          />
        )}

        {error && !editMode && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {editMode ? (
          <Button
            type="button"
            size="lg"
            onClick={exitEditMode}
            className="w-full"
          >
            Done
          </Button>
        ) : (
          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create"}
          </Button>
        )}
      </form>
    </div>
  )
}

function CategoryEditor({
  category,
  label,
  onLabelChange,
  onLabelBlur,
  currentColor,
  onColorPick,
  canReset,
  canDelete,
  onReset,
  onDelete,
}: {
  category: Category
  label: string
  onLabelChange: (s: string) => void
  onLabelBlur: () => void
  currentColor: string | undefined
  onColorPick: (hex: string) => void
  canReset: boolean
  canDelete: boolean
  onReset: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[.03] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: categoryVar(category) }}
          />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Editing {label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canReset && (
            <button
              type="button"
              onClick={onReset}
              title="Reset to default"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete category"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-destructive"
            >
              <Trash2 className="size-3" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Name
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onBlur={onLabelBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onLabelBlur()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <ColorPicker currentColor={currentColor} onColorPick={onColorPick} />
    </div>
  )
}

function NewCategoryForm({
  label,
  onLabelChange,
  color,
  onColorPick,
  onCancel,
  onSubmit,
}: {
  label: string
  onLabelChange: (s: string) => void
  color: string
  onColorPick: (hex: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const ready = label.trim().length > 0
  return (
    <div className="rounded-md border border-white/10 bg-white/[.03] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            New category
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-3" />
          Cancel
        </button>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Name
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder="e.g. Forearms"
          className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          autoFocus
        />
      </div>

      <ColorPicker currentColor={color} onColorPick={onColorPick} />

      <Button
        type="button"
        size="sm"
        disabled={!ready}
        onClick={onSubmit}
        className="w-full"
      >
        Add category
      </Button>
    </div>
  )
}

function ColorPicker({
  currentColor,
  onColorPick,
}: {
  currentColor: string | undefined
  onColorPick: (hex: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">Color</label>
      <div className="mt-2 grid grid-cols-8 gap-2">
        {COLOR_PALETTE.map((hex) => {
          const selected =
            currentColor && currentColor.toLowerCase() === hex.toLowerCase()
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onColorPick(hex)}
              aria-label={`Set color ${hex}`}
              className={cn(
                "size-7 rounded-full border-2 transition",
                selected
                  ? "border-white ring-2 ring-white/30"
                  : "border-white/10 hover:border-white/40"
              )}
              style={{ backgroundColor: hex }}
            />
          )
        })}
      </div>
    </div>
  )
}
