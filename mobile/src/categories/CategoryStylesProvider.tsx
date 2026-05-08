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

export const COLOR_PALETTE: string[] = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#facc15",
  "#a3e635",
  "#4ade80",
  "#34d399",
  "#2dd4bf",
  "#22d3ee",
  "#38bdf8",
  "#60a5fa",
  "#818cf8",
  "#a78bfa",
  "#c084fc",
  "#e879f9",
  "#f472b6",
]

const DEFAULT_LABELS: Record<string, string> = {
  abs: "Abs",
  back: "Back",
  biceps: "Biceps",
  cardio: "Cardio",
  chest: "Chest",
  legs: "Legs",
  shoulders: "Shoulders",
  triceps: "Triceps",
}

const DEFAULT_SET = new Set<string>(DEFAULT_CATEGORIES)
const STORAGE_KEY = "category-styles-v2"
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

interface CategoryEntry {
  label?: string
  color?: string
  custom?: boolean
}
type Entries = Record<string, CategoryEntry>

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

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

async function loadEntries(): Promise<Entries> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Entries = {}
    for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!SLUG_RE.test(key)) continue
      if (!v || typeof v !== "object") continue
      const obj = v as Record<string, unknown>
      const entry: CategoryEntry = {}
      if (typeof obj.label === "string" && obj.label.trim()) {
        entry.label = obj.label.trim()
      }
      if (typeof obj.color === "string" && obj.color.trim()) {
        entry.color = obj.color.trim()
      }
      if (obj.custom === true) entry.custom = true
      if (entry.label || entry.color || entry.custom) out[key] = entry
    }
    return out
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
      setCustomOrder(
        Object.keys(loaded).filter(
          (k) => loaded[k]?.custom && !DEFAULT_SET.has(k)
        )
      )
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
    const trimmed = label.trim()
    setEntries((prev) => {
      const next = { ...prev }
      const existing = next[category] ?? {}
      if (DEFAULT_SET.has(category)) {
        if (!trimmed || trimmed === DEFAULT_LABELS[category]) {
          const rest: CategoryEntry = {}
          if (existing.color) rest.color = existing.color
          if (Object.keys(rest).length === 0) delete next[category]
          else next[category] = rest
        } else {
          next[category] = { ...existing, label: trimmed }
        }
      } else {
        next[category] = {
          ...existing,
          custom: true,
          label: trimmed || category,
        }
      }
      return next
    })
  }, [])

  const setColor = useCallback((category: Category, color: string) => {
    setEntries((prev) => ({
      ...prev,
      [category]: {
        ...(prev[category] ?? {}),
        ...(DEFAULT_SET.has(category) ? {} : { custom: true }),
        color,
      },
    }))
  }, [])

  const resetCategory = useCallback((category: Category) => {
    if (!DEFAULT_SET.has(category)) return
    setEntries((prev) => {
      if (!prev[category]) return prev
      const next = { ...prev }
      delete next[category]
      return next
    })
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
    if (DEFAULT_SET.has(category)) return
    setEntries((prev) => {
      if (!prev[category]) return prev
      const next = { ...prev }
      delete next[category]
      return next
    })
    setCustomOrder((prev) => prev.filter((c) => c !== category))
  }, [])

  const value = useMemo<CategoryStylesValue>(() => {
    const categories: Category[] = [...DEFAULT_CATEGORIES, ...customOrder]
    const labels: Record<Category, string> = {}
    const colors: Partial<Record<Category, string>> = {}
    for (const c of categories) {
      const e = entries[c]
      if (DEFAULT_SET.has(c)) {
        labels[c] = e?.label || DEFAULT_LABELS[c]
      } else {
        labels[c] = e?.label || c
      }
      if (e?.color) colors[c] = e.color
    }
    return {
      categories,
      customCategories: customOrder,
      labels,
      colors,
      setLabel,
      setColor,
      resetCategory,
      isDefault: (c: Category) => DEFAULT_SET.has(c),
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
