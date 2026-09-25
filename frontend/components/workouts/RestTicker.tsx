"use client"

import { useEffect, useRef, useState } from "react"
import { ActionMenu } from "@/components/ui/ActionMenu"
import { TICKER_HIDE_AFTER_S, elapsedS, formatElapsed } from "@lift/core/format"
import { cn } from "@/lib/utils"

/** How long "0s" stays teal after a reset before settling back to muted. */
const TINT_MS = 700

/**
 * The set logger's ticking "Xs since last set" line, the last line of the
 * set-list card. A click opens Reset timer / Stop timer. `anchorMs` is what
 * it counts from (core tickerAnchor); null means nothing to count from.
 *
 * The parent keeps this mounted and the line hides itself, so losing the
 * anchor (Stop timer, deleting the set it counted from, the 30 minute
 * cutoff) collapses it with one motion instead of dropping it in one frame.
 */
export function RestTicker({
  anchorMs,
  onReset,
  onStop,
}: {
  anchorMs: number | null
  onReset: () => void
  onStop: () => void
}) {
  const [, force] = useState(0)
  const shown = anchorMs != null && elapsedS(anchorMs) <= TICKER_HIDE_AFTER_S
  // While collapsing, keep counting from the last anchor it showed: a newly
  // handed-over older anchor would flash its time on the way out.
  const [lastAnchor, setLastAnchor] = useState<number | null>(shown ? anchorMs : null)
  if (shown && anchorMs !== lastAnchor) setLastAnchor(anchorMs)
  const [tinted, setTinted] = useState(false)
  const tintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!shown) return
    const id = setInterval(() => force((c) => c + 1), 250)
    return () => clearInterval(id)
  }, [shown])

  useEffect(
    () => () => {
      if (tintTimer.current) clearTimeout(tintTimer.current)
    },
    []
  )

  function reset() {
    onReset()
    setTinted(true)
    if (tintTimer.current) clearTimeout(tintTimer.current)
    tintTimer.current = setTimeout(() => setTinted(false), TINT_MS)
  }

  if (lastAnchor == null) return null
  const label = formatElapsed(elapsedS(lastAnchor))

  return (
    // Only the collapse animates: a new anchor opens the line at rest, like
    // one that mounts. The clip is only on while collapsed, so the menu can
    // drop below the line while it is open.
    <div
      className={cn(
        "grid",
        shown
          ? "grid-rows-[1fr]"
          : "grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-in-out"
      )}
      aria-hidden={!shown}
      inert={!shown}
    >
      <div className={cn("min-h-0", !shown && "overflow-hidden")}>
        <ActionMenu
          title="Rest timer"
          align="center"
          ariaLabel="Rest timer"
          className="flex w-full"
          triggerClassName="w-full justify-center border-t border-white/[.06] px-3 py-1.5 transition-colors hover:bg-white/[.03]"
          trigger={
            <span
              className={cn(
                "text-center text-xs tabular-nums transition-colors",
                tinted ? "text-secondary duration-0" : "text-muted-foreground duration-700"
              )}
            >
              {label} since last set
            </span>
          }
          items={[
            { label: "Reset timer", onSelect: reset },
            { label: "Stop timer", onSelect: onStop },
          ]}
        />
      </div>
    </div>
  )
}
