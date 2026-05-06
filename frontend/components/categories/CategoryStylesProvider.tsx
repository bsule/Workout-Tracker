"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { DEFAULT_CATEGORIES, type Category } from "@/types"

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

interface CategoryEntry {
  /** Stored label for built-ins is treated as an override; for custom it is the actual label. */
  label?: string
  color?: string
  /** True for user-added categories (not in DEFAULT_CATEGORIES). */
  custom?: boolean
}

type Entries = Record<string, CategoryEntry>

const STORAGE_KEY = "category-styles-v2"
const LEGACY_KEY = "category-styles-v1"

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

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
  /** Add a new custom category. Returns its slug, or null if the label was empty/conflicted. */
  addCategory: (label: string, color: string) => Category | null
  /** Remove a custom category. No-op for defaults. */
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

function loadEntries(): Entries {
  if (typeof window === "undefined") return {}
  const out: Entries = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
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
      }
    }
    // Migrate v1 (built-in only) → v2
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy)
      if (parsed && typeof parsed === "object") {
        for (const c of DEFAULT_CATEGORIES) {
          const v = (parsed as Record<string, unknown>)[c]
          if (v && typeof v === "object") {
            const obj = v as Record<string, unknown>
            const entry: CategoryEntry = {}
            if (typeof obj.label === "string" && obj.label.trim()) {
              entry.label = obj.label.trim()
            }
            if (typeof obj.color === "string" && obj.color.trim()) {
              entry.color = obj.color.trim()
            }
            if (entry.label || entry.color) out[c] = entry
          }
        }
      }
    }
  } catch {
    return {}
  }
  return out
}

export function CategoryStylesProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [entries, setEntries] = useState<Entries>({})
  const [customOrder, setCustomOrder] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const loaded = loadEntries()
    setEntries(loaded)
    // Re-derive custom order from any existing custom slugs in storage.
    setCustomOrder(
      Object.keys(loaded).filter((k) => loaded[k]?.custom && !DEFAULT_SET.has(k))
    )
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // ignore quota / private mode errors
    }
  }, [entries, hydrated])

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

    const isDefault = (c: Category) => DEFAULT_SET.has(c)

    const setLabel = (category: Category, label: string) => {
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
          // Custom: label is required; empty falls back to slug.
          next[category] = {
            ...existing,
            custom: true,
            label: trimmed || category,
          }
        }
        return next
      })
    }

    const setColor = (category: Category, color: string) => {
      setEntries((prev) => ({
        ...prev,
        [category]: {
          ...(prev[category] ?? {}),
          ...(DEFAULT_SET.has(category) ? {} : { custom: true }),
          color,
        },
      }))
    }

    const resetCategory = (category: Category) => {
      if (!DEFAULT_SET.has(category)) return
      setEntries((prev) => {
        if (!prev[category]) return prev
        const next = { ...prev }
        delete next[category]
        return next
      })
    }

    const addCategory = (label: string, color: string): Category | null => {
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
    }

    const removeCategory = (category: Category) => {
      if (DEFAULT_SET.has(category)) return
      setEntries((prev) => {
        if (!prev[category]) return prev
        const next = { ...prev }
        delete next[category]
        return next
      })
      setCustomOrder((prev) => prev.filter((c) => c !== category))
    }

    return {
      categories,
      customCategories: customOrder,
      labels,
      colors,
      setLabel,
      setColor,
      resetCategory,
      isDefault,
      addCategory,
      removeCategory,
    }
  }, [entries, customOrder])

  const styleBody = useMemo(() => {
    const decls: string[] = []
    for (const c of value.categories) {
      const color = value.colors[c]
      if (color) decls.push(`--cat-${c}: ${color};`)
    }
    if (decls.length === 0) return ""
    return `:root{${decls.join("")}}`
  }, [value.categories, value.colors])

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
