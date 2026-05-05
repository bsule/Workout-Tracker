import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  isPr: boolean
  wasPr: boolean
  className?: string
}

/**
 * Renders the right star for a set:
 *  - is_pr=true              → bright filled primary star (current PR)
 *  - was_pr=true && !is_pr   → muted amber filled star (historical PR — "fav")
 *  - otherwise               → faint outline placeholder
 */
export function PrIcon({ isPr, wasPr, className }: Props) {
  if (isPr) {
    return (
      <Star
        className={cn("size-5 shrink-0 fill-primary text-primary", className)}
        aria-label="Current personal record"
      />
    )
  }
  if (wasPr) {
    return (
      <Star
        className={cn(
          "size-5 shrink-0 fill-[oklch(0.78_0.18_80)] text-[oklch(0.78_0.18_80)] opacity-80",
          className
        )}
        aria-label="Historical personal record"
      />
    )
  }
  return (
    <Star
      className={cn("size-5 shrink-0 text-white/10", className)}
      aria-hidden="true"
    />
  )
}
