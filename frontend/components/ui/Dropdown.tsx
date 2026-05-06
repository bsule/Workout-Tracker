"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  description?: string
}

interface Props<T extends string = string> {
  value: T
  onChange: (v: T) => void
  options: DropdownOption<T>[]
  placeholder?: string
  disabled?: boolean
  size?: "sm" | "md"
  align?: "start" | "end"
  className?: string
  triggerClassName?: string
  ariaLabel?: string
}

export function Dropdown<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  size = "md",
  align = "start",
  className,
  triggerClassName,
  ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  )
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const selected = options.find((o) => o.value === value) ?? null

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIdx((i) => (i + 1) % options.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIdx((i) => (i - 1 + options.length) % options.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        const opt = options[activeIdx]
        if (opt) {
          onChange(opt.value)
          setOpen(false)
        }
      } else if (e.key === "Home") {
        e.preventDefault()
        setActiveIdx(0)
      } else if (e.key === "End") {
        e.preventDefault()
        setActiveIdx(options.length - 1)
      }
    }
    window.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    }
  }, [open, options, activeIdx, onChange])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`
    )
    node?.scrollIntoView({ block: "nearest" })
  }, [open, activeIdx])

  // Reset active highlight to the selected item each time we open.
  useEffect(() => {
    if (!open) return
    const i = options.findIndex((o) => o.value === value)
    if (i >= 0) setActiveIdx(i)
  }, [open, options, value])

  const heightCls = size === "sm" ? "h-8 text-xs" : "h-9 text-sm"

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[.03] px-3 text-left transition-colors",
          "hover:border-white/20 hover:bg-white/[.06] focus:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          heightCls,
          open && "border-primary/40",
          triggerClassName
        )}
      >
        <span className={cn(
          "truncate",
          selected ? "text-foreground" : "text-muted-foreground"
        )}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className={cn(
            "absolute z-40 mt-1 max-h-64 w-full min-w-[10rem] overflow-auto rounded-md border border-white/10 bg-popover py-1 shadow-2xl shadow-black/40",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {options.map((opt, i) => {
            const isActive = i === activeIdx
            const isSelected = opt.value === value
            return (
              <li
                key={opt.value}
                data-idx={i}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-sm",
                  isActive ? "bg-white/[.06] text-foreground" : "text-foreground/85",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    isSelected ? "text-primary" : "opacity-0"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{opt.label}</div>
                  {opt.description && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {opt.description}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
