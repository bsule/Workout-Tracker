"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ActionMenuItem {
  label: string
  /** Second line under the label, e.g. why the item is disabled. */
  subtitle?: string
  disabled?: boolean
  destructive?: boolean
  onSelect: () => void
}

/**
 * A button that opens a short list of actions: the web stand-in for mobile's
 * MenuButton / MenuPopup (which show a system action sheet). `trigger` replaces
 * the default "⋯" icon, e.g. the day view's date label.
 */
export function ActionMenu({
  items,
  title,
  trigger,
  align = "end",
  ariaLabel = "More",
  className,
  triggerClassName,
}: {
  items: ActionMenuItem[]
  /** Optional heading above the items, like mobile's "Rest timer". */
  title?: string
  trigger?: ReactNode
  align?: "start" | "end" | "center"
  ariaLabel?: string
  className?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          trigger
            ? "inline-flex items-center"
            : "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
          triggerClassName
        )}
      >
        {trigger ?? <MoreHorizontal className="size-5" />}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-1 min-w-52 overflow-hidden rounded-xl border border-white/10 bg-popover py-1 text-popover-foreground shadow-xl",
            align === "end" && "right-0",
            align === "start" && "left-0",
            align === "center" && "left-1/2 -translate-x-1/2"
          )}
        >
          {title && (
            <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
              {title}
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={cn(
                "flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors",
                item.disabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-white/5",
                item.destructive && !item.disabled && "text-destructive"
              )}
            >
              <span>{item.label}</span>
              {item.subtitle && (
                <span className="text-xs text-muted-foreground">{item.subtitle}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
