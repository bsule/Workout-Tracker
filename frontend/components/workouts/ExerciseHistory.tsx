"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { CalendarDays, ChevronDown, FileText } from "lucide-react"

import type { ExerciseHistoryDay } from "@/types"
import { cn } from "@/lib/utils"
import { PrIcon } from "@/components/workouts/PrIcon"
import { NotePreview } from "@/components/workouts/NotePreview"
import { formatWeight } from "@/lib/units"
import { todayString } from "@lift/core/dates"
import { niceDate } from "@lift/core/format"
import { pastDays } from "@lift/core/exerciseStats"
import {
  useShowPositionPrs,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"

interface Props {
  history: ExerciseHistoryDay[]
  /** The date being logged. Days after it are not shown: a workout dated in
   *  the future can carry logged sets. Defaults to today. */
  currentDate?: string
}

/** Where a day card's calendar icon goes: the calendar with that date picked. */
export function calendarHref(date: string): string {
  return `/calendar?date=${date}`
}

export function ExerciseHistory({ history, currentDate }: Props) {
  const past = useMemo(() => {
    const cutoff = currentDate ?? todayString()
    // Newest first. getExerciseHistoryQ already returns that order; sort
    // defensively since this takes whatever the page hands it.
    return pastDays(history, cutoff).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [history, currentDate])

  if (past.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-6 text-center text-sm text-muted-foreground">
        No past workouts for this exercise yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <SectionTitle>Past sessions</SectionTitle>
      {past.map((day) => (
        <DayBlock key={day.date} day={day} calendarHref={calendarHref(day.date)} />
      ))}
    </div>
  )
}

export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h2
      className={cn(
        "text-xs font-extrabold uppercase tracking-[0.15em] text-muted-foreground",
        className
      )}
    >
      {children}
    </h2>
  )
}

/** The small calendar icon that opens a date on the calendar. */
export function CalendarLink({
  href,
  onClick,
}: {
  href: string
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label="Open in calendar"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    >
      <CalendarDays className="size-4" />
    </Link>
  )
}

/**
 * One day of one exercise: the date, its note, and the sets. The History tab,
 * the Summary tab's last-session card and its record popup all draw this.
 */
export function DayBlock({
  day,
  notes,
  subtitle,
  calendarHref,
  onCalendarClick,
  scrollSets = false,
}: {
  day: ExerciseHistoryDay
  /** Replaces the plain exercise note under the date with a labelled list.
   *  The Summary tab passes it so the session and day notes show up alongside
   *  the exercise note: they are separate rows in the snapshot. */
  notes?: { label: string; text: string }[]
  /** A line under the date, e.g. "3 days ago". */
  subtitle?: string
  /** When set, a calendar icon on the right opens this link. */
  calendarHref?: string
  onCalendarClick?: () => void
  /** Cap the set list's height and scroll it (the record popup). */
  scrollSets?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[.04] px-3 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-bold">{niceDate(day.date)}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          )}
          {!notes && day.note.trim() && <ExpandableNote note={day.note} />}
        </div>
        {calendarHref && (
          <CalendarLink href={calendarHref} onClick={onCalendarClick} />
        )}
      </div>
      {notes && notes.length > 0 && (
        <div className="space-y-1.5 border-b border-white/10 px-3 py-2.5">
          {notes.map((n) => (
            <CollapsibleNote key={n.label} label={n.label} text={n.text} />
          ))}
        </div>
      )}
      <div className={cn(scrollSets && "max-h-[60vh] overflow-y-auto")}>
        <SetRows sets={day.sets} />
      </div>
    </div>
  )
}

/** Mobile's SetList with `showNotes`: PR badge, set number, weight, reps. */
function SetRows({ sets }: { sets: ExerciseHistoryDay["sets"] }) {
  const unit = useWeightUnit()
  const showPositionPrs = useShowPositionPrs()
  return (
    <ul className="divide-y divide-white/10">
      {sets.map((s, i) => (
        <li key={s.id} className="px-3 py-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-9 shrink-0">
              {s.is_pr || s.was_pr ? (
                <PrIcon isPr={s.is_pr} wasPr={s.was_pr} />
              ) : showPositionPrs && (s.is_position_pr || s.was_position_pr) ? (
                <PrIcon
                  isPr={s.is_position_pr}
                  wasPr={s.was_position_pr}
                  variant="position"
                  position={i + 1}
                />
              ) : null}
            </span>
            <span className="w-6 font-mono text-sm font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <span className="flex-1 text-center font-mono text-base font-bold tabular-nums">
              {formatWeight(s.weight, unit)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {unit}
              </span>
            </span>
            <span className="w-12 text-right font-mono text-base font-bold tabular-nums">
              {s.reps ?? "-"}
            </span>
          </div>
          {s.note && (
            <div className="ml-12 mt-0.5 flex items-start gap-1.5 pb-1 text-xs italic text-muted-foreground">
              <FileText className="mt-0.5 size-3 shrink-0 not-italic" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{s.note}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The note on a plain day card. Collapsed it is NotePreview's two lines;
 * clicking opens the whole thing. Notes can run long, and a card that opened
 * them by default pushed its own sets off the screen.
 *
 * The Summary tab uses `CollapsibleNote` instead: it renders three note kinds
 * side by side, so each one needs a label. A history card shows one note, so a
 * label would say nothing.
 */
function ExpandableNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="mt-0.5 flex w-full min-w-0 items-start gap-1.5 text-left transition-opacity active:opacity-55"
      aria-expanded={open}
    >
      <span className="min-w-0 flex-1">
        {open ? (
          <span className="block whitespace-pre-wrap text-xs text-muted-foreground">
            {note.trim()}
          </span>
        ) : (
          <NotePreview note={note} className="text-xs text-muted-foreground" />
        )}
      </span>
      <ChevronDown
        className={cn(
          "mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180"
        )}
      />
    </button>
  )
}

/**
 * One note on a day card. Collapsed it is a single line: a label, the first
 * line of the note, a chevron. Clicking expands the full text. Notes can run
 * long, and rendering them all open pushed the sets off the screen.
 */
function CollapsibleNote({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? ""
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="block w-full border-l-2 border-white/10 py-0.5 pl-2.5 text-left transition-colors hover:border-white/25"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs italic text-muted-foreground",
            // Kept in place but blank when open, so the label and chevron
            // hold their positions.
            open && "opacity-0"
          )}
        >
          {firstLine}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </div>
      {open && (
        <p className="mt-1 whitespace-pre-wrap text-xs italic text-foreground/85">
          {text}
        </p>
      )}
    </button>
  )
}
