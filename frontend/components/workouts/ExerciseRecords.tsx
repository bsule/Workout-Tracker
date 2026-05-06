"use client"

import { Trophy } from "lucide-react"
import type { ExerciseHistoryDay, HistorySet } from "@/types"
import { parseLocalDate } from "@/lib/utils"
import { formatWeight, fromKg, roundForDisplay } from "@/lib/units"
import { useWeightUnit } from "@/components/settings/SettingsProvider"

interface Props {
  history: ExerciseHistoryDay[]
}

type Achievement = {
  set: HistorySet
  date: string
}

type WrAchievement = Achievement & {
  set: HistorySet & { weight: number; reps: number }
}

export function ExerciseRecords({ history }: Props) {
  const unit = useWeightUnit()
  if (history.length === 0) return null

  // Records only apply to weight×reps sets — cardio rows have null weight/reps.
  const all: WrAchievement[] = []
  for (const day of history) {
    for (const s of day.sets) {
      if (s.weight != null && s.reps != null) {
        all.push({ set: s as HistorySet & { weight: number; reps: number }, date: day.date })
      }
    }
  }
  if (all.length === 0) return null

  // Headline records — comparisons use kg (storage) but display converts.
  const best1RM = all.reduce((b, a) =>
    a.set.estimated_one_rm > b.set.estimated_one_rm ? a : b
  )
  const heaviest = all.reduce((b, a) => (a.set.weight > b.set.weight ? a : b))
  const bestVolume = all.reduce((b, a) =>
    a.set.weight * a.set.reps > b.set.weight * b.set.reps ? a : b
  )

  // Per-rep PRs: take the current is_pr sets, ordered by reps ascending.
  const perRep: WrAchievement[] = all
    .filter((a) => a.set.is_pr)
    .sort((a, b) => a.set.reps - b.set.reps)

  return (
    <div className="rounded-2xl border border-white/10 bg-card/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="size-4 text-[oklch(0.78_0.18_80)]" />
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Records
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <HeadlineCard
          label="Best 1RM"
          accent="primary"
          value={roundForDisplay(fromKg(best1RM.set.estimated_one_rm, unit), unit).toFixed(unit === "kg" ? 1 : 0)}
          unit={unit}
          subtitle={`${formatWeight(best1RM.set.weight, unit)} × ${best1RM.set.reps}`}
          date={best1RM.date}
        />
        <HeadlineCard
          label="Heaviest"
          accent="amber"
          value={formatWeight(heaviest.set.weight, unit)}
          unit={unit}
          subtitle={`× ${heaviest.set.reps} reps`}
          date={heaviest.date}
        />
        <HeadlineCard
          label="Best Volume"
          accent="green"
          value={Math.round(fromKg(bestVolume.set.weight * bestVolume.set.reps, unit)).toString()}
          unit={unit}
          subtitle={`${formatWeight(bestVolume.set.weight, unit)} × ${bestVolume.set.reps}`}
          date={bestVolume.date}
        />
      </div>

      {perRep.length > 0 && (
        <div className="mt-5 border-t border-white/5 pt-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            By Reps
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {perRep.map((a) => (
              <RepCard key={a.set.id} ach={a} unit={unit} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function HeadlineCard({
  label,
  value,
  unit,
  subtitle,
  date,
  accent,
}: {
  label: string
  value: string
  unit: string
  subtitle: string
  date: string
  accent: "primary" | "amber" | "green"
}) {
  const dotClass =
    accent === "primary"
      ? "bg-primary"
      : accent === "amber"
        ? "bg-[oklch(0.78_0.18_80)]"
        : "bg-[oklch(0.78_0.18_158)]"
  return (
    <div className="rounded-lg border border-white/5 bg-white/[.02] px-3 py-3">
      <div className="flex items-center gap-1.5">
        <span className={"inline-block size-1.5 rounded-full " + dotClass} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-foreground/70">
          {subtitle}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatShort(date)}
        </span>
      </div>
    </div>
  )
}

function RepCard({ ach, unit }: { ach: WrAchievement; unit: "kg" | "lb" }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[.06] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
        {ach.set.reps} rep{ach.set.reps === 1 ? "" : "s"}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
          {formatWeight(ach.set.weight, unit)}
        </span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        {formatShort(ach.date)}
      </div>
    </div>
  )
}

function formatShort(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  })
}
