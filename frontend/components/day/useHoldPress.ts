"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** Mobile's HoldPressable delay: how long a press must be held to count. */
export const HOLD_DELAY = 350
/** A pointer that travels further than this is a drag or a scroll, not a hold. */
const MOVE_SLOP = 8

/**
 * Press-and-hold for any pointer, the web stand-in for mobile's HoldPressable.
 * `holding` is true while the hold is building, so the caller can shrink the
 * element over exactly `HOLD_DELAY` as a progress cue. As on mobile, the click
 * that ends a hold does not also count as a click: holding a card to start a
 * selection must not toggle it straight back off on release.
 */
export function useHoldPress({
  onPress,
  onLongPress,
}: {
  onPress: () => void
  onLongPress?: () => void
}) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
    setHolding(false)
  }, [])

  useEffect(() => cancel, [cancel])

  const handlers = {
    onPointerDown(e: React.PointerEvent) {
      fired.current = false
      if (!onLongPress || (e.pointerType === "mouse" && e.button !== 0)) return
      origin.current = { x: e.clientX, y: e.clientY }
      setHolding(true)
      timer.current = setTimeout(() => {
        timer.current = null
        origin.current = null
        fired.current = true
        setHolding(false)
        onLongPress()
      }, HOLD_DELAY)
    },
    onPointerMove(e: React.PointerEvent) {
      const o = origin.current
      if (!o) return
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick(e: React.MouseEvent) {
      if (fired.current) {
        fired.current = false
        e.preventDefault()
        return
      }
      onPress()
    },
    // A touch hold would otherwise open the browser's context menu.
    onContextMenu(e: React.MouseEvent) {
      if (onLongPress) e.preventDefault()
    },
  }

  return { holding, handlers }
}
