"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ScrollText, X } from "lucide-react"
import type { ExerciseHistoryDay, HistorySet } from "@/types"
import { cn, parseLocalDate } from "@/lib/utils"
import { formatWeight } from "@/lib/units"
import { estimateOneRm, getDayNoteQ, getWorkoutByDateQ } from "@/lib/store"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import { Dropdown } from "@/components/ui/Dropdown"
import { DayBlock } from "@/components/workouts/ExerciseHistory"

interface Props {
  history: ExerciseHistoryDay[]
  /** The date being logged right now. The last-session card then shows the
   *  newest session *before* it, so it never mirrors the sets being entered
   *  on this page. Omit on the exercise page, where the newest session is
   *  the last one. */
  excludeDate?: string
}

// Records only apply to weight×reps sets — cardio rows have null weight/reps.
type WrSet = HistorySet & { weight: number; reps: number }
type Dated = { set: WrSet; date: string }

// "all" = every set position pooled; otherwise the 1-based set number as string.
type Scope = "all" | string

// How the rep-record rows are ordered, and what the bar in each row measures.
// The bar always tracks the active sort, so the list reads as one shape.
type RepSort = "weight" | "oneRm" | "reps" | "recent"
const REP_SORTS: { key: RepSort; label: string; hint: string }[] = [
  { key: "weight", label: "Heaviest", hint: "Top weight first" },
  { key: "oneRm", label: "Best 1RM", hint: "Strongest set first" },
  { key: "reps", label: "Most reps", hint: "Highest rep count first" },
  { key: "recent", label: "Recent", hint: "Newest record first" },
]

// Rows shown before the "Show all" toggle is clicked.
const REP_ROWS_COLLAPSED = 3

export function ExerciseSummary({ history, excludeDate }: Props) {
  const unit = useWeightUnit()

  // getExerciseHistoryQ returns days newest-first, but this component takes
  // whatever the page hands it — sort defensively before picking the last one.
  const ordered = useMemo(
    () => [...history].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [history]
  )

  const lastDay = useMemo(
    () => ordered.find((d) => !excludeDate || d.date < excludeDate) ?? null,
    [ordered, excludeDate]
  )

  // The three note kinds that can hang off that date. They are independent
  // rows in the snapshot and any of them can be empty.
  const lastNotes = useMemo(() => {
    if (!lastDay) return []
    const out: { label: string; text: string }[] = []
    const exercise = lastDay.note.trim()
    if (exercise) out.push({ label: "Exercise", text: exercise })
    const session = (getWorkoutByDateQ(lastDay.date)?.notes ?? "").trim()
    if (session) out.push({ label: "Session", text: session })
    const day = getDayNoteQ(lastDay.date).trim()
    if (day) out.push({ label: "Day", text: day })
    return out
  }, [lastDay])

  const all: Dated[] = useMemo(() => {
    const out: Dated[] = []
    for (const day of history) {
      for (const s of day.sets) {
        if (s.weight != null && s.reps != null) {
          out.push({ set: s as WrSet, date: day.date })
        }
      }
    }
    return out
  }, [history])

  // Set numbers actually performed (order is 0-based → set number is order+1),
  // sorted ascending. Drives the dropdown; never padded to a fixed range.
  const setNumbers = useMemo(() => {
    const nums = new Set<number>()
    for (const a of all) nums.add(a.set.order + 1)
    return [...nums].sort((x, y) => x - y)
  }, [all])

  const [scope, setScope] = useState<Scope>("all")
  const [sort, setSort] = useState<RepSort>("weight")
  const [showAllRows, setShowAllRows] = useState(false)
  // The date whose sets the record popup is showing, or null when closed.
  const [recordDate, setRecordDate] = useState<string | null>(null)

  // Sets in the selected scope ("all", or a single set position).
  const scoped = useMemo(
    () =>
      scope === "all"
        ? all
        : all.filter((a) => a.set.order + 1 === Number(scope)),
    [all, scope]
  )

  const repRows = useMemo(() => rowsPerRep(scoped, sort), [scoped, sort])

  const recordDay = useMemo(
    () => ordered.find((d) => d.date === recordDate) ?? null,
    [ordered, recordDate]
  )

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-card/40 p-6 text-center">
        <ScrollText className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing logged for this exercise yet. Log a few sets to see your last
          session and your records here.
        </p>
      </div>
    )
  }

  const scopeOptions = [
    { value: "all", label: "All sets", description: `${all.length} sets` },
    ...setNumbers.map((n) => {
      const count = all.filter((a) => a.set.order + 1 === n).length
      return {
        value: String(n),
        label: `Set ${n}`,
        description: count === 1 ? "1 time" : `${count} times`,
      }
    }),
  ]

  const sortOptions = REP_SORTS.map((s) => ({
    value: s.key,
    label: s.label,
    description: s.hint,
  }))

  return (
    <div className="space-y-6">
      {/* Last session */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Last session
          </h2>
          {lastDay && (
            <span className="text-[11px] text-muted-foreground">
              {agoLabel(lastDay.date)}
            </span>
          )}
        </div>
        {lastDay ? (
          <DayBlock
            day={lastDay}
            notes={lastNotes}
            dateHref={`/workouts/date/${lastDay.date}`}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-6 text-center text-sm text-muted-foreground">
            No earlier session for this exercise.
          </div>
        )}
      </section>

      {/* Rep records */}
      {repRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Rep records
            </h2>
            <div className="flex items-center gap-2">
              <Dropdown
                value={scope}
                onChange={(v) => {
                  setScope(v)
                  setShowAllRows(false)
                }}
                options={scopeOptions}
                size="sm"
                align="end"
                className="w-32"
                ariaLabel="Select set number"
              />
              <Dropdown
                value={sort}
                onChange={(v) => {
                  setSort(v as RepSort)
                  setShowAllRows(false)
                }}
                options={sortOptions}
                size="sm"
                align="end"
                className="w-32"
                ariaLabel="Sort rep records"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/5 bg-card/40">
            {repRows.slice(0, REP_ROWS_COLLAPSED).map((row, i) => (
              <RepRow
                key={row.reps}
                row={row}
                unit={unit}
                first={i === 0}
                onOpen={() => setRecordDate(row.date)}
              />
            ))}

            {/* grid-template-rows 0fr→1fr is the one way to transition to a
                height the browser has to measure, so the extra rows slide
                open instead of appearing. */}
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out",
                showAllRows ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}
            >
              <div className="overflow-hidden">
                {repRows.slice(REP_ROWS_COLLAPSED).map((row) => (
                  <RepRow
                    key={row.reps}
                    row={row}
                    unit={unit}
                    first={false}
                    onOpen={() => setRecordDate(row.date)}
                  />
                ))}
              </div>
            </div>

            {repRows.length > REP_ROWS_COLLAPSED && (
              <button
                type="button"
                onClick={() => setShowAllRows((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-white/5 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-white/[.03]"
              >
                {showAllRows
                  ? `Show top ${REP_ROWS_COLLAPSED}`
                  : `Show all ${repRows.length} rep counts`}
                <ChevronDown
                  className={
                    "size-3.5 transition-transform " +
                    (showAllRows ? "rotate-180" : "")
                  }
                />
              </button>
            )}
          </div>
        </section>
      )}

      <RecordDayDialog day={recordDay} onClose={() => setRecordDate(null)} />
    </div>
  )
}

type RepRowData = ReturnType<typeof rowsPerRep>[number]

function RepRow({
  row,
  unit,
  first,
  onOpen,
}: {
  row: RepRowData
  unit: "kg" | "lb"
  first: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        // Every row carries the transparent edge so marking one never shifts
        // its text.
        "block w-full border-l-[3px] border-l-transparent px-3 py-2.5 text-left transition-colors hover:bg-white/[.04]",
        !first && "border-t border-t-white/5",
        row.isTopOneRm &&
          "border-l-[oklch(0.78_0.18_80)] bg-[oklch(0.78_0.18_80_/_0.05)]"
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {formatWeight(row.weightKg, unit)}
        </span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
        <span className="font-mono text-sm font-medium tabular-nums text-muted-foreground">
          × {row.reps} {row.reps === 1 ? "rep" : "reps"}
        </span>
        {row.isTopOneRm && (
          <span className="rounded-full bg-[oklch(0.78_0.18_80_/_0.16)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[oklch(0.78_0.18_80)]">
            Best
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {formatShort(row.date)}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            row.isTopOneRm ? "bg-[oklch(0.78_0.18_80)]" : "bg-primary"
          )}
          style={{
            width: `${Math.max(2, row.share * 100)}%`,
            // Shorter bars also sit back, so the ranking reads even where two
            // rows are close in length.
            opacity: 0.45 + row.share * 0.55,
          }}
        />
      </div>
    </button>
  )
}

/**
 * What a record row opens: the date it was set, and every set logged for this
 * exercise that day. Read-only — click the backdrop or press Escape to close.
 */
function RecordDayDialog({
  day,
  onClose,
}: {
  day: ExerciseHistoryDay | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!day) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [day, onClose])

  if (!day) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md"
        // Clicks inside the card must not reach the backdrop's close handler.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-white/10 bg-card/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* dateHref turns the card's date into a link to that day — the same
            affordance the last-session card has. */}
        <DayBlock
          day={day}
          notes={[]}
          dateHref={`/workouts/date/${day.date}`}
        />
      </div>
    </div>
  )
}

/**
 * Reduce a list of sets to one row per rep count: the heaviest entry at that
 * rep count, how many sets used it, and its estimated 1RM. Only rep counts
 * present appear.
 *
 * `share` drives the bar width and always measures whatever `sort` orders by,
 * so the bar lengths and the row order tell the same story. "Recent" has no
 * useful magnitude, so it falls back to weight.
 */
function rowsPerRep(sets: Dated[], sort: RepSort) {
  const best = new Map<
    number,
    { weightKg: number; date: string; count: number }
  >()
  for (const a of sets) {
    const cur = best.get(a.set.reps)
    if (!cur) {
      best.set(a.set.reps, { weightKg: a.set.weight, date: a.date, count: 1 })
      continue
    }
    cur.count += 1
    if (a.set.weight > cur.weightKg) {
      cur.weightKg = a.set.weight
      cur.date = a.date
    }
  }
  const rows = [...best.entries()].map(([reps, v]) => ({
    reps,
    weightKg: v.weightKg,
    date: v.date,
    count: v.count,
    oneRmKg: estimateOneRm(v.weightKg, reps),
  }))

  const metric = (r: (typeof rows)[number]) =>
    sort === "reps" ? r.reps : sort === "oneRm" ? r.oneRmKg : r.weightKg

  rows.sort((a, b) => {
    if (sort === "recent") {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return b.weightKg - a.weightKg
    }
    const diff = metric(b) - metric(a)
    // Ties break on the harder set: more reps at the same weight.
    return diff !== 0 ? diff : b.reps - a.reps
  })

  const maxMetric = rows.reduce((m, r) => (metric(r) > m ? metric(r) : m), 0)

  // The single strongest row, by index rather than by value: several rep counts
  // can estimate to the same 1RM, and marking every tie made the whole table
  // gold. Ties go to the row that did more reps for it.
  let topIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (topIdx < 0) {
      topIdx = i
      continue
    }
    const best = rows[topIdx]
    if (rows[i].oneRmKg > best.oneRmKg) topIdx = i
    else if (rows[i].oneRmKg === best.oneRmKg && rows[i].reps > best.reps) {
      topIdx = i
    }
  }

  return rows.map((r, i) => ({
    ...r,
    share: maxMetric > 0 ? metric(r) / maxMetric : 0,
    isTopOneRm: i === topIdx,
  }))
}

function formatShort(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  })
}

// "Yesterday" / "6 days ago" / "3 weeks ago". Both sides are floored to local
// midnight so the answer follows calendar days, not elapsed hours — a session
// 20 hours ago still reads "Yesterday".
function agoLabel(iso: string): string {
  const then = parseLocalDate(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - then.getTime()) / 86400000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return w === 1 ? "1 week ago" : `${w} weeks ago`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return m === 1 ? "1 month ago" : `${m} months ago`
  }
  const y = Math.floor(days / 365)
  return y === 1 ? "1 year ago" : `${y} years ago`
}
