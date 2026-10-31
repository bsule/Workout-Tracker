"use client"

import type { ReactNode } from "react"
import { Modal } from "@/components/ui/Modal"
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
  return (
    <Modal open={open} onClose={onClose} title={title} className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </Modal>
  )
}

export const modalInputClass =
  "h-11 w-full rounded-md border border-border bg-foreground/[.04] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
