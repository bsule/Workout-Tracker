import { cn } from "@/lib/utils"

interface SpinnerProps {
  /** Visual size in px (square). Default 24. */
  size?: number
  className?: string
}

export function Spinner({ size = 24, className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block", className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full animate-spin"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="3"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="text-primary"
        />
      </svg>
    </span>
  )
}

/** Centered spinner block for inline loading regions (tab content, lists). */
export function LoadingBlock({
  className,
  size = 28,
}: {
  className?: string
  size?: number
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center py-10 text-muted-foreground",
        className
      )}
    >
      <Spinner size={size} />
    </div>
  )
}

/** Full-page spinner — fills the available main area and centers in both axes. */
export function FullPageLoader({ size = 36 }: { size?: number }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-muted-foreground">
      <Spinner size={size} />
    </div>
  )
}
