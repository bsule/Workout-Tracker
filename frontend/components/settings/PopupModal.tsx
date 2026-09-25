"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePresence } from "@/components/ui/usePresence"
import { cn } from "@/lib/utils"

/**
 * A centered card with a title, the web copy of mobile's PopupModal. Fades in
 * and out with the same timing as ConfirmDialog and NoteSheet. A click on the
 * backdrop or Escape closes it.
 */
export function PopupModal({
  open,
  title,
  onClose,
  children,
  className,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra classes for the card, e.g. a wider max width. */
  className?: string
}) {
  const { mounted, shown } = usePresence(open)
  // Keep the last title while fading out, so the card does not blank first.
  const [shownTitle, setShownTitle] = useState(title)
  if (open && shownTitle !== title) setShownTitle(title)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm transition-opacity duration-150",
        shown ? "opacity-100" : "opacity-0"
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={shownTitle}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl transition-all duration-150 ease-out",
          shown ? "scale-100 opacity-100" : "scale-95 opacity-0",
          className
        )}
      >
        <h2 className="text-base font-semibold tracking-tight">{shownTitle}</h2>
        {children}
      </div>
    </div>
  )
}

export const modalInputClass =
  "h-11 w-full rounded-md border border-border bg-foreground/[.04] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
