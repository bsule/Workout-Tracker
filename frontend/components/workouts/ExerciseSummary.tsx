"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Layers,
  type LucideIcon,
} from "lucide-react"
import type { ExerciseHistoryDay } from "@/types"
import { cn } from "@/lib/utils"
import { formatWeight } from "@/lib/units"
import { getDayNoteQ, getWorkoutByDateQ } from "@/lib/store"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import {
  DayBlock,
  SectionTitle,
  calendarHref,
} from "@/components/workouts/ExerciseHistory"
import { agoLabel, recordDate } from "@lift/core/format"
import {
  REP_ROWS_COLLAPSED,
  REP_SORTS,
  pickLastSession,
  repRecordRows,
  setNumbersOf,
  weightRepSets,
  type RepRecordRow,
  type RepSort,
} from "@lift/core/exerciseStats"

interface Props {
  history: ExerciseHistoryDay[]
  /** The date being logged right now. The last-session card then shows the
   *  newest session *before* it, so it never mirrors the sets being entered
   *  on this page. Omit on the exercise page, where the newest session is
   *  the last one. */
  excludeDate?: string
}

/**
 * The Summary tab: what you did last time for this exercise, the notes
 * attached to that day, and your best set at every rep count you have
 * performed. Mirrors mobile's SummaryPanel.
 */
export function ExerciseSummary({ history, excludeDate }: Props) {
  const unit = useWeightUnit()

  // pickLastSession expects newest first. getExerciseHistoryQ returns that
  // order, but this takes whatever the page hands it, so sort defensively.
  const ordered = useMemo(
    () => [...history].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [history]
  )

  const lastDay = useMemo(
    () => pickLastSession(ordered, excludeDate),
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

  const wrSets = useMemo(() => weightRepSets(history), [history])
  const setNumbers = useMemo(() => setNumbersOf(wrSets), [wrSets])

  // "all" pools every position; otherwise restrict to one set number.
  const [scope, setScope] = useState<"all" | number>("all")
  const [sort, setSort] = useState<RepSort>("weight")
  const [showAllRows, setShowAllRows] = useState(false)
  // The date whose sets the record popup is showing, or null when closed.
  const [recordDay, setRecordDay] = useState<string | null>(null)

  const scoped = useMemo(
    () => (scope === "all" ? wrSets : wrSets.filter((s) => s.setNum === scope)),
    [wrSets, scope]
  )

  const repRows = useMemo(() => repRecordRows(scoped, sort), [scoped, sort])

  const shownRecordDay = useMemo(
    () => ordered.find((d) => d.date === recordDay) ?? null,
    [ordered, recordDay]
  )

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-6 text-center text-sm text-muted-foreground">
        Nothing logged for this exercise yet. Log a few sets to see your last
        session and your records here.
      </div>
    )
  }

  const sortLabel =
    REP_SORTS.find((s) => s.key === sort)?.label ?? REP_SORTS[0].label

  return (
    <div className="space-y-3">
      <SectionTitle>Last session</SectionTitle>
      {lastDay ? (
        <DayBlock
          day={lastDay}
          subtitle={agoLabel(lastDay.date)}
          notes={lastNotes}
          calendarHref={calendarHref(lastDay.date)}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-6 text-center text-sm text-muted-foreground">
          No earlier session for this exercise.
        </div>
      )}

      {repRows.length > 0 && (
        <>
          <SectionTitle className="pt-2">Rep records</SectionTitle>

          <div className="flex gap-2">
            <PickerChip
              icon={Layers}
              label={scope === "all" ? "All sets" : `Set ${scope}`}
              title="Show set"
              options={[
                {
                  id: "all",
                  title: "All sets",
                  subtitle: `${wrSets.length} ${wrSets.length === 1 ? "set" : "sets"}`,
                  selected: scope === "all",
                },
                ...setNumbers.map((n) => {
                  const count = wrSets.filter((s) => s.setNum === n).length
                  return {
                    id: String(n),
                    title: `Set ${n}`,
                    subtitle: `${count} ${count === 1 ? "time" : "times"}`,
                    selected: scope === n,
                  }
                }),
              ]}
              onSelect={(id) => {
                setScope(id === "all" ? "all" : Number(id))
                setShowAllRows(false)
              }}
            />
            <PickerChip
              icon={ArrowUpDown}
              label={sortLabel}
              title="Sort by"
              options={REP_SORTS.map((o) => ({
                id: o.key,
                title: o.label,
                subtitle: o.hint,
                selected: sort === o.key,
              }))}
              onSelect={(id) => {
                setSort(id as RepSort)
                setShowAllRows(false)
              }}
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/5 bg-card">
            {repRows.slice(0, REP_ROWS_COLLAPSED).map((row, i) => (
              <RepRow
                key={row.reps}
                row={row}
                unit={unit}
                first={i === 0}
                onOpen={() => setRecordDay(row.date)}
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
                    onOpen={() => setRecordDay(row.date)}
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
                  className={cn(
                    "size-3.5 transition-transform",
                    showAllRows && "rotate-180"
                  )}
                />
              </button>
            )}
          </div>

          <RecordDayDialog
            day={shownRecordDay}
            onClose={() => setRecordDay(null)}
          />
        </>
      )}
    </div>
  )
}

function RepRow({
  row,
  unit,
  first,
  onOpen,
}: {
  row: RepRecordRow
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
          {recordDate(row.date)}
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

type PickerOption = {
  id: string
  title: string
  subtitle?: string
  selected: boolean
}

/**
 * A chip that opens a menu of choices, like mobile's PickerTrigger. The chip
 * shows the current one, and the menu marks it with a checkmark.
 */
function PickerChip({
  icon: Icon,
  label,
  title,
  options,
  onSelect,
}: {
  icon: LucideIcon
  label: string
  title: string
  options: PickerOption[]
  onSelect: (id: string) => void
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
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg border border-white/10 bg-card px-3 py-2 text-left transition-colors hover:bg-white/[.04]"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-50 mt-1 min-w-48 overflow-hidden rounded-xl border border-white/10 bg-popover py-1 text-popover-foreground shadow-xl"
        >
          <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
            {title}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.selected}
                onClick={() => {
                  setOpen(false)
                  onSelect(o.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block">{o.title}</span>
                  {o.subtitle && (
                    <span className="block text-xs text-muted-foreground">
                      {o.subtitle}
                    </span>
                  )}
                </span>
                {o.selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * What a record row opens: the date it was set, and every set logged for this
 * exercise that day. Read-only. Click the backdrop or press Escape to close,
 * or the calendar icon to open that day, same as the last-session card.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md"
        // Clicks inside the card must not reach the backdrop's close handler.
        onClick={(e) => e.stopPropagation()}
      >
        <DayBlock
          day={day}
          scrollSets
          calendarHref={calendarHref(day.date)}
          // Close as the link navigates: the popup must not sit over the
          // calendar while it loads.
          onCalendarClick={onClose}
        />
      </div>
    </div>
  )
}
