// AsyncStorage-backed mirror of frontend/components/categories/CategoryStylesProvider.tsx.
// Per-device only — matches the web's localStorage semantics.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { DEFAULT_CATEGORIES } from "@lift/core"
import type { Category } from "@lift/core"
import {
  CATEGORY_STYLES_STORAGE_KEY,
  COLOR_PALETTE,
  customOrderFrom,
  deriveCategoryStyles,
  isDefaultCategory,
  parseCategoryEntriesJson,
  resetCategoryEntry,
  setCategoryColor,
  setCategoryLabel,
  slugify,
  type CategoryEntries,
} from "@lift/core/categoryStyles"

// The palette, labels, slug rules and entry edits live in
// @lift/core/categoryStyles so the web app follows the same rules. This file
// keeps the React state, AsyncStorage, and the theme's default colors.
export { COLOR_PALETTE }

const STORAGE_KEY = CATEGORY_STYLES_STORAGE_KEY

type Entries = CategoryEntries

interface CategoryStylesValue {
  categories: Category[]
  customCategories: Category[]
  labels: Record<Category, string>
  colors: Partial<Record<Category, string>>
  setLabel: (category: Category, label: string) => void
  setColor: (category: Category, color: string) => void
  resetCategory: (category: Category) => void
  isDefault: (category: Category) => boolean
  addCategory: (label: string, color: string) => Category | null
  removeCategory: (category: Category) => void
}

const Ctx = createContext<CategoryStylesValue | null>(null)

async function loadEntries(): Promise<Entries> {
  try {
    return parseCategoryEntriesJson(await AsyncStorage.getItem(STORAGE_KEY))
  } catch {
    return {}
  }
}

export function CategoryStylesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entries>({})
  const [customOrder, setCustomOrder] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadEntries()
      if (cancelled) return
      setEntries(loaded)
      setCustomOrder(customOrderFrom(loaded))
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {})
  }, [entries, hydrated])

  const setLabel = useCallback((category: Category, label: string) => {
    setEntries((prev) => setCategoryLabel(prev, category, label))
  }, [])

  const setColor = useCallback((category: Category, color: string) => {
    setEntries((prev) => setCategoryColor(prev, category, color))
  }, [])

  const resetCategory = useCallback((category: Category) => {
    if (!isDefaultCategory(category)) return
    setEntries((prev) => resetCategoryEntry(prev, category))
  }, [])

  const addCategory = useCallback(
    (label: string, color: string): Category | null => {
      const base = slugify(label)
      if (!base) return null
      let slug = base
      let n = 2
      const taken = new Set<string>([...DEFAULT_CATEGORIES, ...customOrder])
      while (taken.has(slug)) {
        const suffix = `-${n}`
        slug = (base.slice(0, 32 - suffix.length) + suffix).replace(/^-+/, "")
        n += 1
        if (n > 50) return null
      }
      setEntries((prev) => ({
        ...prev,
        [slug]: { custom: true, label: label.trim() || slug, color },
      }))
      setCustomOrder((prev) => [...prev, slug])
      return slug
    },
    [customOrder]
  )

  const removeCategory = useCallback((category: Category) => {
    if (isDefaultCategory(category)) return
    setEntries((prev) => {
      if (!prev[category]) return prev
      const next = { ...prev }
      delete next[category]
      return next
    })
    setCustomOrder((prev) => prev.filter((c) => c !== category))
  }, [])

  const value = useMemo<CategoryStylesValue>(() => {
    const { categories, customCategories, labels, colors } = deriveCategoryStyles({
      entries,
      customOrder,
    })
    return {
      categories,
      customCategories,
      labels,
      colors,
      setLabel,
      setColor,
      resetCategory,
      isDefault: (c: Category) => isDefaultCategory(c),
      addCategory,
      removeCategory,
    }
  }, [
    entries,
    customOrder,
    setLabel,
    setColor,
    resetCategory,
    addCategory,
    removeCategory,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCategoryStyles(): CategoryStylesValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error(
      "useCategoryStyles must be used within CategoryStylesProvider"
    )
  }
  return ctx
}

// Hook resolver for a single category's color. Falls back to the theme's
// default category palette, then to muted. Use this in render code; the
// static `categoryColor()` in theme.ts remains for legacy callers but
// will not see custom-category overrides.
import { theme } from "../theme/theme"
export function useCategoryColor(slug: string): string {
  const { colors } = useCategoryStyles()
  return (
    colors[slug] ?? theme.colors.cat[slug] ?? theme.colors.muted
  )
}

// Hook resolver for a category's display label.
export function useCategoryLabel(slug: string): string {
  const { labels } = useCategoryStyles()
  return labels[slug] ?? slug
}
