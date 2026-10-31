"use client"

import type { ReactNode } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

/** Shared modal behavior: portal, focus trap/return, scroll lock and Escape. */
export function Modal({ open, onClose, title, children, className, initialFocus }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  initialFocus?: Dialog.Popup.Props["initialFocus"]
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          aria-label={title}
          initialFocus={initialFocus}
          className={cn("fixed left-1/2 top-1/2 z-[101] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl outline-none transition-[opacity,scale] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:transition-none", className)}
        >
          {children}
          <Dialog.Close className="sr-only" tabIndex={-1}>Close dialog</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
