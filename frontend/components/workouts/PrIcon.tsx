import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  isPr: boolean
  wasPr: boolean
  variant?: "overall" | "position"
  position?: number
  className?: string
}

export function PrIcon({
  isPr,
  wasPr,
  variant = "overall",
  position,
  className,
}: Props) {
  if (variant === "position") {
    if (!isPr && !wasPr) {
      return (
        <Star
          className={cn("size-4 shrink-0 text-white/10", className)}
          aria-hidden="true"
        />
      )
    }
    const label = position != null ? `${position}PR` : "PR"
    const tone = isPr
      ? "bg-blue-500 text-white"
      : "bg-blue-500/40 text-blue-100 opacity-80"
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-sm px-1 py-0 text-[9px] font-extrabold leading-none tracking-wide tabular-nums",
          tone,
          className
        )}
        aria-label={
          isPr
            ? "Set-position personal record"
            : "Historical set-position personal record"
        }
      >
        {label}
      </span>
    )
  }
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
