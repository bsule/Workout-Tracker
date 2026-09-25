// Pure category-styles model shared by both clients, lifted from mobile's
// CategoryStylesProvider. Labels and colors are per device: each client keeps
// the entries in its own storage (web localStorage, mobile AsyncStorage) under
// CATEGORY_STYLES_STORAGE_KEY and runs them through these functions. Nothing
// here touches the Snapshot, so nothing here syncs.
//
// Colors not set by the user are left out of `colors`; each client falls back
// to its own theme's default category palette.

import { DEFAULT_CATEGORIES } from "./types"
import type { Category } from "./types"

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

export const DEFAULT_LABELS: Record<string, string> = {
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
export const CATEGORY_STYLES_STORAGE_KEY = "category-styles-v2"
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

export interface CategoryEntry {
  /** For a built-in, an override of its default label; for a custom
   *  category, the label itself. */
  label?: string
  color?: string
  /** True for user-added categories (not in DEFAULT_CATEGORIES). */
  custom?: boolean
}
export type CategoryEntries = Record<string, CategoryEntry>

/** The whole model: stored entries plus the custom categories in the order
 *  they were added. */
export interface CategoryStylesState {
  entries: CategoryEntries
  customOrder: Category[]
}

export interface CategoryStylesView {
  /** Built-ins first, then custom categories in insertion order. */
  categories: Category[]
  customCategories: Category[]
  labels: Record<Category, string>
  /** Only the user's color choices; undefined means the theme default. */
  colors: Partial<Record<Category, string>>
}

export function isDefaultCategory(category: Category): boolean {
  return DEFAULT_SET.has(category)
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

/** Validates entries read back from storage (already JSON-parsed). Drops
 *  bad slugs, non-object values, and empty entries; trims strings. */
export function parseCategoryEntries(parsed: unknown): CategoryEntries {
  if (!parsed || typeof parsed !== "object") return {}
  const out: CategoryEntries = {}
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

/** The raw stored string to entries. Unreadable JSON is an empty map. */
export function parseCategoryEntriesJson(raw: string | null | undefined): CategoryEntries {
  if (!raw) return {}
  try {
    return parseCategoryEntries(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** Custom categories found in loaded entries, in stored key order. */
export function customOrderFrom(entries: CategoryEntries): Category[] {
  return Object.keys(entries).filter(
    (k) => entries[k]?.custom && !DEFAULT_SET.has(k)
  )
}

export function stateFromEntries(entries: CategoryEntries): CategoryStylesState {
  return { entries, customOrder: customOrderFrom(entries) }
}

/** Rename a category. A built-in set back to its default label (or blank)
 *  drops the override; a custom one left blank falls back to its slug. */
export function setCategoryLabel(
  entries: CategoryEntries,
  category: Category,
  label: string
): CategoryEntries {
  const trimmed = label.trim()
  const next = { ...entries }
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
}

export function setCategoryColor(
  entries: CategoryEntries,
  category: Category,
  color: string
): CategoryEntries {
  return {
    ...entries,
    [category]: {
      ...(entries[category] ?? {}),
      ...(DEFAULT_SET.has(category) ? {} : { custom: true }),
      color,
    },
  }
}

/** Drop a built-in's label and color overrides. No-op for custom ones. */
export function resetCategoryEntry(
  entries: CategoryEntries,
  category: Category
): CategoryEntries {
  if (!DEFAULT_SET.has(category)) return entries
  if (!entries[category]) return entries
  const next = { ...entries }
  delete next[category]
  return next
}

/** Add a custom category. The slug comes from the label, with "-2", "-3", ...
 *  on a clash. Null when the label has no usable characters or no free slug
 *  turns up. */
export function addCategoryEntry(
  state: CategoryStylesState,
  label: string,
  color: string
): { state: CategoryStylesState; slug: Category } | null {
  const base = slugify(label)
  if (!base) return null
  let slug = base
  let n = 2
  const taken = new Set<string>([...DEFAULT_CATEGORIES, ...state.customOrder])
  while (taken.has(slug)) {
    const suffix = `-${n}`
    slug = (base.slice(0, 32 - suffix.length) + suffix).replace(/^-+/, "")
    n += 1
    if (n > 50) return null
  }
  return {
    slug,
    state: {
      entries: {
        ...state.entries,
        [slug]: { custom: true, label: label.trim() || slug, color },
      },
      customOrder: [...state.customOrder, slug],
    },
  }
}

/** Remove a custom category. No-op for built-ins. */
export function removeCategoryEntry(
  state: CategoryStylesState,
  category: Category
): CategoryStylesState {
  if (DEFAULT_SET.has(category)) return state
  let entries = state.entries
  if (entries[category]) {
    entries = { ...entries }
    delete entries[category]
  }
  return {
    entries,
    customOrder: state.customOrder.filter((c) => c !== category),
  }
}

export function deriveCategoryStyles(state: CategoryStylesState): CategoryStylesView {
  const { entries, customOrder } = state
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
  return { categories, customCategories: customOrder, labels, colors }
}

/** True for a built-in whose label or color the user changed, which is when
 *  the editor offers "Reset to default". */
export function canResetCategory(view: CategoryStylesView, category: Category): boolean {
  if (!DEFAULT_SET.has(category)) return false
  return (
    view.colors[category] != null ||
    (view.labels[category] ?? DEFAULT_LABELS[category]) !== DEFAULT_LABELS[category]
  )
}
