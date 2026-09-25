"use client"

import type { Category } from "@/types"
import { categoryVar, cn } from "@/lib/utils"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"

/**
 * Outlined category label, the web copy of mobile's CategoryPill: the border
 * is the category color at 0.55 alpha and the text at 0.85. The color is the
 * `--cat-*` variable, which already carries the user's color override.
 */
export function CategoryPill({
  category,
  className,
}: {
  category: Category
  className?: string
}) {
  const { labels } = useCategoryStyles()
  const color = categoryVar(category)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-extrabold tracking-tight",
        className
      )}
      style={{
        borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
        color: `color-mix(in srgb, ${color} 85%, transparent)`,
      }}
    >
      {labels[category] ?? category}
    </span>
  )
}
