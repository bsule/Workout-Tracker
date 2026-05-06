"use client"

import type { Category } from "@/types"
import { categoryVar, cn } from "@/lib/utils"
import { useCategoryStyles } from "@/components/categories/CategoryStylesProvider"

interface Props {
  category: Category
  showLabel?: boolean
  size?: "sm" | "md"
  className?: string
}

export function CategoryDot({
  category,
  size = "md",
  className,
}: {
  category: Category
  size?: "sm" | "md"
  className?: string
}) {
  const { labels } = useCategoryStyles()
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        size === "sm" ? "size-2" : "size-2.5",
        className
      )}
      style={{ backgroundColor: categoryVar(category) }}
      aria-label={labels[category]}
    />
  )
}

export function CategoryBadge({
  category,
  showLabel = true,
  size = "md",
  className,
}: Props) {
  const { labels } = useCategoryStyles()
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        "bg-white/5 text-foreground/90 border border-white/10",
        className
      )}
    >
      <CategoryDot category={category} size={size} />
      {showLabel && labels[category]}
    </span>
  )
}
