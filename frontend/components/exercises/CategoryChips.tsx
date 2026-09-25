"use client"

import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"
import { cn } from "@/lib/utils"
import { categoryColor } from "./CategoryBadge"

/**
 * A wrapping grid of category chips, each with its color dot, the web copy of
 * mobile's CategoryChips. Used to pick an exercise's category and to filter
 * the exercise list by one.
 */
export function CategoryChips({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (cat: string) => void
}) {
  const { categories, labels } = useCategoryStyles()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {categories.map((cat) => {
        const active = selected === cat
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(cat)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm font-medium transition-colors",
              active
                ? "border-foreground bg-foreground/[.1] text-foreground"
                : "border-transparent bg-card text-foreground hover:bg-foreground/[.06]"
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(cat) }}
            />
            <span className="truncate">{labels[cat] ?? cat}</span>
          </button>
        )
      })}
    </div>
  )
}
