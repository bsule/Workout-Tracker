import { useEffect, useState } from "react"

/**
 * Mount/fade state for a popup: `mounted` turns on as soon as `open` does and
 * stays on through the fade-out; `shown` turns on one frame after mounting
 * (so the fade-in has a starting frame) and off as soon as `open` turns off.
 * The instant changes are made while rendering, not in an effect; only the
 * frame and timer changes wait, in their own callbacks.
 */
export function usePresence(open: boolean, exitMs = 180): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  if (open && !mounted) setMounted(true)
  if (!open && shown) setShown(false)

  useEffect(() => {
    if (open) {
      const f = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(f)
    }
    if (!mounted) return
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [open, mounted, exitMs])

  return { mounted, shown }
}
