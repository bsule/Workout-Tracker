"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, History } from "lucide-react"
import {
  topRepRecords,
  topRepRecordsByPosition,
  type TopRepRecord,
} from "@/lib/store"
import { formatWeight } from "@/lib/units"
import { cn, parseLocalDate } from "@/lib/utils"
import type { ExerciseHistoryDay } from "@/types"

interface Props {
  days: ExerciseHistoryDay[]
  currentDate: string
  nextPosition: number
  isWeightReps?: boolean
  unit: "kg" | "lb"
  onShowMore?: () => void
}

const POSITION_ROWS = 3

function formatDate(iso: string): string {
  try {
    const d = parseLocalDate(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function agoLabel(iso: string): string {
  try {
    const d = parseLocalDate(iso)
    const now = new Date()
    const diffDays = Math.round(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (diffDays <= 0) return "today"
    if (diffDays === 1) return "yesterday"
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`
    return formatDate(iso)
  } catch {
    return iso
  }
}

function findLastSession(days: ExerciseHistoryDay[], currentDate: string) {
  for (const d of days) {
    if (d.date >= currentDate) continue
    const validSets = d.sets.filter(
      (s): s is typeof s & { weight: number; reps: number } =>
        s.weight != null && s.reps != null
    )
    if (validSets.length > 0) return { date: d.date, sets: validSets }
  }
  return null
}

export function LastTimePanel({
  days,
  currentDate,
  nextPosition,
  isWeightReps = true,
  unit,
  onShowMore,
}: Props) {
  const last = useMemo(
    () => findLastSession(days, currentDate),
    [days, currentDate]
  )

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

  const [open, setOpen] = useState(true)

  if (!last && top.length === 0 && !positionMode) {
    return null
  }

  const posRecords = positionMode ? byPosition.get(nextPosition) ?? [] : []

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-card/60 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] transition-all">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left group"
        >
          <History className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
            {positionMode ? "Top weights" : "Last time"}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs font-medium text-foreground/80">
            {positionMode ? `Set ${nextPosition}` : last ? agoLabel(last.date) : "History"}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
        </button>

        {onShowMore && (
          <button
            type="button"
            onClick={onShowMore}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Summary
            <ChevronRight className="size-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="p-4 space-y-4">
          {positionMode ? (
            <div className="space-y-2">
              {posRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No record yet for set {nextPosition}.
                </p>
              ) : (
                posRecords.map((r) => (
                  <RecordRow key={r.reps} r={r} unit={unit} />
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {last && (
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    {formatDate(last.date)} ({agoLabel(last.date)})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {last.sets.map((s, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-lg border border-white/10 bg-white/[.03] px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-foreground/90"
                      >
                        {formatWeight(s.weight, unit)}
                        <span className="text-muted-foreground ml-0.5 mr-1 text-[10px] font-sans">
                          {unit}
                        </span>
                        <span className="text-muted-foreground mr-1">×</span>
                        {s.reps}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {top.length > 0 && (
                <div className="pt-2 border-t border-white/5 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Top weights
                  </div>
                  {top.map((r) => (
                    <RecordRow key={r.reps} r={r} unit={unit} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecordRow({ r, unit }: { r: TopRepRecord; unit: "kg" | "lb" }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5 font-mono">
        <span className="font-semibold text-foreground tabular-nums">
          {formatWeight(r.weightKg, unit)}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase font-sans">
          {unit}
        </span>
        <span className="text-muted-foreground">×</span>
        <span className="text-foreground tabular-nums">{r.reps}</span>
        <span className="text-[10px] text-muted-foreground font-sans">
          {r.reps === 1 ? "rep" : "reps"}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {formatDate(r.date)}
      </span>
    </div>
  )
}
