"use client"

import { FileText } from "lucide-react"
import type { WorkoutSet } from "@/types"
import { PrIcon } from "@/components/workouts/PrIcon"
import {
  useShowPositionPrs,
  useWeightUnit,
} from "@/components/settings/SettingsProvider"
import { formatWeight } from "@/lib/units"
import { cn } from "@/lib/utils"

/**
 * The compact set list on a day-view card, the web copy of mobile's SetList:
 * no column headers, an icon column that stays empty when the set holds no
 * PR, "-" for missing reps, and each set's note under its row (never on a
 * target set).
 */
export function SetList({
  sets,
  showNotes = false,
}: {
  sets: WorkoutSet[]
  showNotes?: boolean
}) {
  const unit = useWeightUnit()
  const showPositionPrs = useShowPositionPrs()
  return (
    <ul>
      {sets.map((s, i) => (
        <li
          key={s.id}
          className={cn(
            "border-b border-foreground/15 last:border-b-0",
            s.is_planned && "opacity-60"
          )}
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="flex w-7 shrink-0 items-center">
              {s.is_planned ? (
                <span
                  className="size-2 rounded-full border-[1.5px] border-dashed border-primary"
                  aria-label="Target set"
                />
              ) : s.is_pr || s.was_pr ? (
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
            <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <span
              className={cn(
                "flex-1 text-center text-base font-bold tabular-nums",
                s.is_planned && "italic text-muted-foreground"
              )}
            >
              {formatWeight(s.weight, unit)}{" "}
              <span className="text-xs font-normal not-italic text-muted-foreground">
                {unit}
              </span>
            </span>
            <span
              className={cn(
                "w-[50px] shrink-0 text-right text-base font-bold tabular-nums",
                s.is_planned && "italic text-muted-foreground"
              )}
            >
              {s.reps ?? "-"}
            </span>
          </div>
          {showNotes && !s.is_planned && !!s.note && (
            <div className="ml-10 flex items-start gap-1.5 pr-2 pb-2 -mt-0.5">
              <FileText className="mt-[3px] size-[11px] shrink-0 text-muted-foreground" />
              <p className="flex-1 whitespace-pre-wrap text-[11.5px] leading-4 italic text-muted-foreground">
                {s.note}
              </p>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
