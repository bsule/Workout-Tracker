"use client"

// Rows for the Settings hub and its sub-pages, the web copy of mobile's
// components/SettingRows.tsx. A SettingsGroup is one card; the rows inside it
// are separated by a divider, like iOS Settings.

import Link from "next/link"
import { Children, Fragment, isValidElement, type ReactNode } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Small uppercase heading above a group. */
export function SettingsHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-3 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </h2>
  )
}

/** One card of rows. Pass `inset` when the rows have icons, so the divider
 *  starts after the icon tile. */
export function SettingsGroup({
  children,
  inset = false,
}: {
  children: ReactNode
  inset?: boolean
}) {
  const rows = Children.toArray(children)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((row, i) => (
        // Children.toArray gives every row a key of its own (its explicit key,
        // or its position among the written children), so a row shown or
        // hidden conditionally does not shift the ones after it.
        <Fragment key={isValidElement(row) ? (row.key ?? i) : i}>
          {i > 0 && (
            <div className={cn("h-px bg-border", inset ? "ml-[60px]" : "ml-4")} />
          )}
          {row}
        </Fragment>
      ))}
    </div>
  )
}

/** Small print under a group. */
export function SettingsFooter({ children }: { children: ReactNode }) {
  return (
    <p className="-mt-1 px-1 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

const rowBase =
  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[.04] active:bg-foreground/[.07]"

/** A row that opens another page: icon tile, title, subtitle, chevron. */
export function NavRow({
  icon: Icon,
  title,
  subtitle,
  badge,
  href,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  badge?: boolean
  href: string
}) {
  return (
    <Link href={href} className={cn(rowBase, "min-h-[60px]")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[.08]">
        <Icon className="size-[18px] text-foreground" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground">{title}</span>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {badge && (
        <span
          className="size-2 shrink-0 rounded-full bg-destructive"
          aria-label="Needs attention"
        />
      )}
      <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** An on/off setting. A click anywhere on the row toggles it; the switch is
 *  display only, so the row and the switch never both claim the click. */
export function SwitchRow({
  label,
  subtitle,
  value,
  onChange,
}: {
  label: string
  subtitle?: string
  value: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(rowBase, "min-h-[52px]")}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground">{label}</span>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      <Switch on={value} />
    </button>
  )
}

/** The switch drawn inside SwitchRow. The track uses the teal secondary
 *  accent, like mobile, not the primary blue. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-secondary" : "bg-foreground/[.14]"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] size-[27px] rounded-full bg-white shadow transition-transform duration-200",
          on ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
      />
    </span>
  )
}

/** A setting with two or three short choices, drawn as a segmented control.
 *  Every segment has the same minimum width, so short labels ("kg") match
 *  longer ones ("Light") and the controls on a page line up. */
export function SegmentRow({
  label,
  options,
}: {
  label: string
  options: { label: string; active: boolean; onSelect: () => void }[]
}) {
  return (
    <div className="flex min-h-[52px] flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex-1 text-[15px] font-semibold text-foreground">{label}</span>
      <div className="flex rounded-md border border-border bg-foreground/[.04] p-0.5">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={o.active}
            onClick={o.active ? undefined : o.onSelect}
            className={cn(
              "min-w-14 rounded-[5px] px-2 py-1.5 text-sm font-semibold transition-colors",
              o.active
                ? "bg-foreground/[.12] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Label on the left, value and pencil on the right; a click edits it. */
export function EditableRow({
  label,
  value,
  onEdit,
  icon,
}: {
  label: string
  value: string
  onEdit: () => void
  icon: ReactNode
}) {
  return (
    <button type="button" onClick={onEdit} className={cn(rowBase, "justify-between")}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[15px] font-semibold text-foreground">{value}</span>
        {icon}
      </span>
    </button>
  )
}

/** A settings sub-page: back link to the hub, title, then the groups. */
export function SettingsPage({
  title,
  subtitle,
  back = { href: "/settings", label: "Settings" },
  children,
}: {
  title: string
  subtitle?: string
  back?: { href: string; label: string } | null
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6 sm:py-8">
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronRight className="size-4 rotate-180" />
          {back.label}
        </Link>
      )}
      <h1 className="text-2xl font-display tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  )
}

/** A plain card for content that is not a list of rows. */
export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
        className
      )}
    >
      {children}
    </div>
  )
}
