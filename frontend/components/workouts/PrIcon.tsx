import { cn } from "@/lib/utils"

interface Props {
  isPr: boolean
  wasPr: boolean
  variant?: "overall" | "position"
  position?: number
  className?: string
}

// Tailwind doesn't have a "PR-gold" color out of the box; matching the
// mobile palette keeps the iconography consistent across platforms.
const GOLD_BG = "#e0c050"
const GOLD_FG = "#1a1a1a"
const POSITION_BG = "#4a90e2"

export function PrIcon({
  isPr,
  wasPr,
  variant = "overall",
  position,
  className,
}: Props) {
  const isPosition = variant === "position"

  if (!isPr && !wasPr) {
    // Reserve column width so the rows stay aligned.
    return <span className={cn("inline-block size-4", className)} aria-hidden="true" />
  }

  const label = isPosition && position != null ? `${position}PR` : "PR"
  const historical = !isPr && wasPr

  const baseClasses =
    "inline-flex shrink-0 items-center justify-center rounded-[3px] font-bold leading-none tabular-nums"

  const sizeClasses = "px-1 py-[3px] text-[9px]"

  const style = historical
    ? { background: "rgba(154,154,154,0.9)", color: "#fff" }
    : isPosition
      ? { background: POSITION_BG, color: "#fff" }
      : { background: GOLD_BG, color: GOLD_FG }

  return (
    <span
      className={cn(baseClasses, sizeClasses, className)}
      style={style}
      aria-label={
        historical
          ? isPosition
            ? "Historical set-position personal record"
            : "Historical personal record"
          : isPosition
            ? "Set-position personal record"
            : "Current personal record"
      }
    >
      {label}
    </span>
  )
}
