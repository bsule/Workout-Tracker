"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react"
import { DEFAULT_CATEGORIES, type Category } from "@/types"
import {
  CATEGORY_STYLES_STORAGE_KEY,
  COLOR_PALETTE,
  addCategoryEntry,
  canResetCategory,
  deriveCategoryStyles,
  isDefaultCategory,
  parseCategoryEntries,
  removeCategoryEntry,
  resetCategoryEntry,
  setCategoryColor,
  setCategoryLabel,
  stateFromEntries,
  type CategoryEntries,
  type CategoryEntry,
  type CategoryStylesState,
} from "@lift/core/categoryStyles"

// The model (labels, colors, slugs, custom categories) lives in
// @lift/core/categoryStyles so both clients follow the same rules. This file
// only keeps it in localStorage, per browser, like mobile keeps it per device.
export { COLOR_PALETTE }

const LEGACY_KEY = "category-styles-v1"

interface CategoryStylesValue {
  /** All categories the user sees, defaults first then custom in insertion order. */
  categories: Category[]
  /** Custom (user-added) category slugs. */
  customCategories: Category[]
  labels: Record<Category, string>
  /** Per-category color override; undefined means use the default CSS var. */
  colors: Partial<Record<Category, string>>
  setLabel: (category: Category, label: string) => void
  setColor: (category: Category, color: string) => void
  resetCategory: (category: Category) => void
  /** True for built-in categories that cannot be deleted. */
  isDefault: (category: Category) => boolean
  /** True for a built-in with a label or color override. */
  canReset: (category: Category) => boolean
  /** Add a new custom category. Returns its slug, or null if the label was empty/conflicted. */
  addCategory: (label: string, color: string) => Category | null
  /** Remove a custom category. No-op for defaults. */
  removeCategory: (category: Category) => void
}

const Ctx = createContext<CategoryStylesValue | null>(null)

function loadEntries(): CategoryEntries {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(CATEGORY_STYLES_STORAGE_KEY)
    if (raw) return parseCategoryEntries(JSON.parse(raw))
    // Web only: v1 held overrides for the built-ins and nothing else.
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (!legacy) return {}
    const parsed = JSON.parse(legacy)
    if (!parsed || typeof parsed !== "object") return {}
    const builtIns: Record<string, CategoryEntry> = {}
    for (const c of DEFAULT_CATEGORIES) {
      const v = (parsed as Record<string, unknown>)[c]
      if (v && typeof v === "object") {
        const { label, color } = v as Record<string, unknown>
        builtIns[c] = { label: label as string, color: color as string }
      }
    }
    return parseCategoryEntries(builtIns)
  } catch {
    return {}
  }
}

// The styles as an external store over localStorage: one parsed copy per
// page, replaced on every edit, so the provider reads it without mirroring it
// into state after mount. The server (and hydration) render the defaults.
const SERVER_STYLES: CategoryStylesState = { entries: {}, customOrder: [] }
let styles: CategoryStylesState | null = null
const styleListeners = new Set<() => void>()

function readStyles(): CategoryStylesState {
  if (styles == null) {
    const hadCurrent = window.localStorage.getItem(CATEGORY_STYLES_STORAGE_KEY) != null
    styles = stateFromEntries(loadEntries())
    // Entries read from the v1 key are written under the current one.
    if (!hadCurrent && Object.keys(styles.entries).length > 0) save(styles.entries)
  }
  return styles
}

function serverStyles(): CategoryStylesState {
  return SERVER_STYLES
}

function subscribeStyles(cb: () => void): () => void {
  styleListeners.add(cb)
  return () => {
    styleListeners.delete(cb)
  }
}

function save(entries: CategoryEntries) {
  try {
    window.localStorage.setItem(CATEGORY_STYLES_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // ignore quota / private mode errors
  }
}

// addCategory returns the new slug right away, so every edit reads and
// replaces the store copy directly rather than waiting for a render.
function commit(next: CategoryStylesState) {
  styles = next
  save(next.entries)
  for (const l of styleListeners) l()
}

export function CategoryStylesProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const state = useSyncExternalStore(subscribeStyles, readStyles, serverStyles)
  const setLabel = useCallback(
    (category: Category, label: string) => {
      const s = readStyles()
      commit({ ...s, entries: setCategoryLabel(s.entries, category, label) })
    },
    []
  )

  const setColor = useCallback(
    (category: Category, color: string) => {
      const s = readStyles()
      commit({ ...s, entries: setCategoryColor(s.entries, category, color) })
    },
    []
  )

  const resetCategory = useCallback(
    (category: Category) => {
      const s = readStyles()
      const entries = resetCategoryEntry(s.entries, category)
      if (entries !== s.entries) commit({ ...s, entries })
    },
    []
  )

  const addCategory = useCallback(
    (label: string, color: string): Category | null => {
      const res = addCategoryEntry(readStyles(), label, color)
      if (!res) return null
      commit(res.state)
      return res.slug
    },
    []
  )

  const removeCategory = useCallback(
    (category: Category) => {
      const s = readStyles()
      const next = removeCategoryEntry(s, category)
      if (next !== s) commit(next)
    },
    []
  )

  const view = useMemo(() => deriveCategoryStyles(state), [state])

  const value = useMemo<CategoryStylesValue>(() => {
    return {
      ...view,
      setLabel,
      setColor,
      resetCategory,
      isDefault: isDefaultCategory,
      canReset: (c: Category) => canResetCategory(view, c),
      addCategory,
      removeCategory,
    }
  }, [view, setLabel, setColor, resetCategory, addCategory, removeCategory])

  const styleBody = useMemo(() => {
    const decls: string[] = []
    for (const c of view.categories) {
      const color = view.colors[c]
      if (color) decls.push(`--cat-${c}: ${color};`)
    }
    if (decls.length === 0) return ""
    return `:root{${decls.join("")}}`
  }, [view])

  return (
    <Ctx value={value}>
      {styleBody && <style id="category-styles-overrides">{styleBody}</style>}
      {children}
    </Ctx>
  )
}

export function useCategoryStyles(): CategoryStylesValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error("useCategoryStyles must be used within CategoryStylesProvider")
  }
  return ctx
}
