"use client"

import { useEffect, useState } from "react"
import { RotateCcw, Timer, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  anchorMs: number
  onReset?: () => void
  onStop?: () => void
  className?: string
}

const HIDE_AFTER_S = 1800 // 30 minutes

export function RestTicker({ anchorMs, onReset, onStop, className }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [stoppedAnchor, setStoppedAnchor] = useState<number | null>(null)

  // Re-render periodically to update elapsed time from clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  if (stoppedAnchor === anchorMs) return null

  const elapsed = Math.max(0, Math.floor((now - anchorMs) / 1000))
  if (elapsed > HIDE_AFTER_S) return null

  let timeStr: string
  if (elapsed < 60) {
    timeStr = `${elapsed}s`
  } else {
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    timeStr = `${m}m ${s}s`
  }

  function handleStop() {
    setStoppedAnchor(anchorMs)
    onStop?.()
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl border border-primary/20 bg-primary/[.04] px-4 py-2.5 text-xs text-foreground/90 transition-colors",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Timer className="size-4 text-primary animate-pulse" />
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {timeStr}
        </span>
        <span className="text-muted-foreground">since last set</span>
      </div>
      <div className="flex items-center gap-1">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
            title="Reset timer"
          >
            <RotateCcw className="size-3" />
            <span>Reset</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          className="inline-flex items-center gap-1 rounded-md p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
          title="Dismiss timer"
          aria-label="Dismiss timer"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
