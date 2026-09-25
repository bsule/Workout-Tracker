"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react"
import {
  topRepRecords,
  topRepRecordsByPosition,
  type TopRepRecord,
} from "@/lib/store"
import { formatWeight } from "@/lib/units"
import { agoLabel, recordDate } from "@lift/core/format"
import {
  lastSessionBefore,
  lastSessionSummary,
  lastTimeCardOpen,
} from "@lift/core/setLogger"
import { cn } from "@/lib/utils"
import type { ExerciseHistoryDay } from "@/types"

interface Props {
  days: ExerciseHistoryDay[]
  /** The day being logged. Its own sets are already on screen above. */
  currentDate: string
  /** 1-based position the next save takes; 1 means nothing logged today. */
  nextPosition: number
  /** Set positions only mean something for weight x reps exercises. */
  isWeightReps?: boolean
  unit: "kg" | "lb"
  /** Opens the Summary tab, which carries the full record table. */
  onShowMore?: () => void
}

/** Top-weight rows the card shows, overall and per position. */
const POSITION_ROWS = 3

/**
 * "What to beat", under the set list. Mobile's LastTimePanel, without its
 * animations. Two modes, picked by `nextPosition`:
 *
 * - Last time (nothing logged today): the previous session as chips, then the
 *   top weights across every set of the exercise.
 * - Top weights (a set is down): the top weights for the set position about
 *   to be logged.
 *
 * Renders nothing when the exercise has no earlier session and no records.
 */
export function LastTimePanel({
  days,
  currentDate,
  nextPosition,
  isWeightReps = true,
  unit,
  onShowMore,
}: Props) {
  const last = useMemo(() => lastSessionBefore(days, currentDate), [days, currentDate])

  // Records come from every day except the one being logged: today's sets are
  // on screen above, and the position shown is always one today hasn't filled.
  const priorDays = useMemo(
    () => days.filter((d) => d.date !== currentDate),
    [days, currentDate]
  )
  const top = useMemo(() => topRepRecords(priorDays, POSITION_ROWS), [priorDays])
  const byPosition = useMemo(
    () => topRepRecordsByPosition(priorDays, POSITION_ROWS),
    [priorDays]
  )

  const hasSets = nextPosition >= 2
  const positionMode = isWeightReps && hasSets

  // null until the user touches the chevron; after that it's their choice.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = lastTimeCardOpen({
    manual,
    positionMode,
    hasSets,
    hasLast: last != null,
  })

  if (!last && top.length === 0) return null

  const posRecords = (byPosition.get(nextPosition) ?? []).slice(0, POSITION_ROWS)
  const collapsedLine = last ? lastSessionSummary(last.sets, unit) : ""

  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={() => setManual(!open)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
            {positionMode ? "Top weights" : "Last time"}
          </span>
          <span className="ml-auto truncate text-xs">
            {positionMode ? (
              <span className="font-extrabold text-foreground">Set {nextPosition}</span>
            ) : last ? (
              <span className="text-muted-foreground">{agoLabel(last.date)}</span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground",
              !open && "-rotate-90"
            )}
          />
        </button>
        {last && !positionMode && (
          <Link
            href={`/calendar?date=${last.date}`}
            aria-label="Open this session on the calendar"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <CalendarDays className="size-4" />
          </Link>
        )}
      </div>

      {open ? (
        <div className="space-y-2 px-4 pb-3">
          {positionMode ? (
            posRecords.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No record yet for set {nextPosition}.
              </p>
            ) : (
              posRecords.map((r) => <TopWeightRow key={r.reps} r={r} unit={unit} />)
            )
          ) : (
            <>
              {last ? (
                <div className="flex flex-wrap gap-1.5">
                  {last.sets.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center rounded-full border border-white/10 bg-card px-2 py-1 text-xs font-bold tabular-nums text-foreground"
                    >
                      {formatWeight(s.weight, unit)}
                      <span className="mx-1 font-normal text-muted-foreground">×</span>
                      {s.reps}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  No earlier session for this exercise.
                </p>
              )}
              {top.length > 0 && (
                <>
                  <div className="border-t border-white/5 pt-2 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Top weights
                  </div>
                  {top.map((r) => (
                    <TopWeightRow key={r.reps} r={r} unit={unit} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      ) : (
        !positionMode &&
        collapsedLine && (
          <p className="truncate px-4 pb-3 text-xs font-bold tabular-nums text-foreground">
            {collapsedLine}
          </p>
        )
      )}

      {onShowMore && (
        <button
          type="button"
          onClick={onShowMore}
          className="flex min-h-10 w-full items-center justify-center gap-1 rounded-b-2xl border-t border-white/10 text-xs font-bold text-foreground transition-colors hover:bg-white/[.03]"
        >
          Show more
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

/** One "top weight for N reps" line: weight, rep count, and the date. */
function TopWeightRow({ r, unit }: { r: TopRepRecord; unit: "kg" | "lb" }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-sm font-extrabold tabular-nums text-foreground">
        {formatWeight(r.weightKg, unit)}
        <span className="ml-1 text-[10px] font-semibold text-muted-foreground">{unit}</span>
      </span>
      <span className="font-semibold text-muted-foreground">
        × {r.reps} {r.reps === 1 ? "rep" : "reps"}
      </span>
      <span className="ml-auto text-muted-foreground">{recordDate(r.date)}</span>
    </div>
  )
}
