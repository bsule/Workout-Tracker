"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"

import type { ExerciseHistoryDay } from "@/types"
import { cn, formatDayLabel, parseLocalDate } from "@/lib/utils"
import { PrIcon } from "@/components/workouts/PrIcon"
import { NotePreview } from "@/components/workouts/NotePreview"
import { formatWeight, fromKg, roundForDisplay } from "@/lib/units"
import {
  useShowPositionPrs,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"

interface Props {
  history: ExerciseHistoryDay[]
  currentDate?: string
}

export function ExerciseHistory({ history, currentDate }: Props) {
  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-10 text-center text-sm text-muted-foreground">
        No history for this exercise yet.
      </div>
    )
  }

  // Newest first.
  const ordered = [...history].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="space-y-4">
      {ordered.map((day) => (
        <DayBlock
          key={day.date}
          day={day}
          isCurrent={day.date === currentDate}
        />
      ))}
    </div>
  )
}

export function DayBlock({
  day,
  isCurrent = false,
  notes,
  dateHref,
}: {
  day: ExerciseHistoryDay
  isCurrent?: boolean
  /** Replaces the plain exercise-note strip with a labelled list. The Summary
   *  tab passes it so the session and day notes show up alongside the
   *  exercise note — they are separate rows in the snapshot. */
  notes?: { label: string; text: string }[]
  /** When set, the header date becomes a link to that day. */
  dateHref?: string
}) {
  const unit = useWeightUnit()
  const showPositionPrs = useShowPositionPrs()
  const longDate = parseLocalDate(day.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const bestSet = day.sets.reduce(
    (best, s) =>
      s.estimated_one_rm > (best?.estimated_one_rm ?? 0) ? s : best,
    null as ExerciseHistoryDay["sets"][number] | null
  )

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-card/40",
        isCurrent ? "border-primary/40" : "border-white/10"
      )}
    >
      <div
        className={cn(
          "flex items-baseline justify-between border-b px-4 py-3",
          isCurrent
            ? "border-primary/20 bg-primary/[.06]"
            : "border-white/5 bg-white/[.02]"
        )}
      >
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex items-center gap-2">
            {dateHref ? (
              <Link
                href={dateHref}
                className="text-sm font-semibold tracking-tight underline-offset-4 hover:underline"
              >
                {formatDayLabel(day.date)}
              </Link>
            ) : (
              <span className="text-sm font-semibold tracking-tight">
                {formatDayLabel(day.date)}
              </span>
            )}
            {isCurrent && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Current
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{longDate}</div>
          {!notes && day.note && <ExpandableNote note={day.note} />}
        </div>
        {bestSet && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Best 1RM
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">
              {roundForDisplay(fromKg(bestSet.estimated_one_rm, unit), unit).toFixed(unit === "kg" ? 1 : 0)}
              <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                {unit}
              </span>
            </div>
          </div>
        )}
      </div>
      {notes && notes.length > 0 && (
        <div className="space-y-1.5 border-b border-white/5 px-4 py-2.5">
          {notes.map((n) => (
            <CollapsibleNote key={n.label} label={n.label} text={n.text} />
          ))}
        </div>
      )}
      <ul className="divide-y divide-white/5">
        {day.sets.map((s, i) => (
          <li key={s.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center gap-3">
              {s.is_pr || s.was_pr ? (
                <PrIcon isPr={s.is_pr} wasPr={s.was_pr} className="min-w-9" />
              ) : showPositionPrs ? (
                <PrIcon
                  isPr={s.is_position_pr}
                  wasPr={s.was_position_pr}
                  variant="position"
                  position={i + 1}
                  className="min-w-9"
                />
              ) : (
                <PrIcon isPr={false} wasPr={false} className="min-w-9" />
              )}
              <span className="font-mono w-6 text-sm font-medium tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="ml-auto font-mono text-base font-semibold tabular-nums">
                {formatWeight(s.weight, unit)}
                <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                  {unit}
                </span>
              </span>
              <span className="font-mono w-20 text-right text-base font-semibold tabular-nums">
                {s.reps}
                <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                  reps
                </span>
              </span>
            </div>
            {s.note && (
              <p className="mt-1 ml-7 whitespace-pre-wrap text-xs text-muted-foreground italic">
                {s.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
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
      className="mt-0.5 flex w-full min-w-0 items-start gap-1.5 text-left"
      aria-expanded={open}
    >
      <span className="min-w-0 flex-1">
        {open ? (
          <span className="block whitespace-pre-wrap text-xs text-foreground/80">
            {note.trim()}
          </span>
        ) : (
          <NotePreview note={note} className="text-xs text-foreground/80" />
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
 * One note on a day card. Collapsed it is a single line — a label, the first
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
      className="block w-full border-l-2 border-white/10 py-0.5 pl-2.5 text-left transition-colors hover:border-white/25"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-xs italic text-muted-foreground">
            {firstLine}
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "ml-auto rotate-180" : ""
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
