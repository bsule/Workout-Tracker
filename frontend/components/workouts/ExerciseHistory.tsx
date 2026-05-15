"use client"

import type { ExerciseHistoryDay } from "@/types"
import { cn, formatDayLabel, parseLocalDate } from "@/lib/utils"
import { PrIcon } from "@/components/workouts/PrIcon"
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

function DayBlock({
  day,
  isCurrent = false,
}: {
  day: ExerciseHistoryDay
  isCurrent?: boolean
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
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {formatDayLabel(day.date)}
            </span>
            {isCurrent && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Current
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{longDate}</div>
        </div>
        {bestSet && (
          <div className="text-right">
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
