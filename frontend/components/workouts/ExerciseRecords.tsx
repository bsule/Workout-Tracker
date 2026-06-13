"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Trophy } from "lucide-react"
import type { ExerciseHistoryDay, HistorySet } from "@/types"
import { parseLocalDate } from "@/lib/utils"
import { formatWeight, fromKg, roundForDisplay } from "@/lib/units"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import { Dropdown } from "@/components/ui/Dropdown"

interface Props {
  history: ExerciseHistoryDay[]
}

// Records only apply to weight×reps sets — cardio rows have null weight/reps.
type WrSet = HistorySet & { weight: number; reps: number }
type Dated = { set: WrSet; date: string }

// "all" = every set position pooled; otherwise the 1-based set number as string.
type Scope = "all" | string

export function ExerciseRecords({ history }: Props) {
  const unit = useWeightUnit()
  const router = useRouter()
  const goToDate = (date: string) => router.push(`/workouts/date/${date}`)

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

  if (all.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-card/40 p-6 text-center">
        <Trophy className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          No records yet. Log a few sets to see your bests here.
        </p>
      </div>
    )
  }

  // Headline records — comparisons use kg (storage) but display converts.
  const oneRepSets = all.filter((a) => a.set.reps === 1)
  const best1RM = oneRepSets.length
    ? oneRepSets.reduce((b, a) => (a.set.weight > b.set.weight ? a : b))
    : all.reduce((b, a) =>
        a.set.estimated_one_rm > b.set.estimated_one_rm ? a : b
      )
  const best1RMIsEstimated = oneRepSets.length === 0
  const heaviest = all.reduce((b, a) => (a.set.weight > b.set.weight ? a : b))
  const bestVolume = all.reduce((b, a) =>
    a.set.weight * a.set.reps > b.set.weight * b.set.reps ? a : b
  )

  // Sets in the selected scope ("all", or a single set position).
  const scoped =
    scope === "all"
      ? all
      : all.filter((a) => a.set.order + 1 === Number(scope))

  // Best weight at each rep count actually performed in scope, reps ascending.
  const byReps = bestWeightPerRep(scoped)

  // Scope summary: best estimated 1RM and how many sets were logged here.
  const scopeBest1RM = scoped.reduce(
    (m, a) => (a.set.estimated_one_rm > m ? a.set.estimated_one_rm : m),
    0
  )

  const options = [
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

  return (
    <div className="space-y-4">
      {/* Headline records */}
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
            value={
              best1RMIsEstimated
                ? roundForDisplay(
                    fromKg(best1RM.set.estimated_one_rm, unit),
                    unit
                  ).toFixed(unit === "kg" ? 1 : 0)
                : formatWeight(best1RM.set.weight, unit)
            }
            unit={unit}
            subtitle={
              best1RMIsEstimated
                ? `est. from ${formatWeight(best1RM.set.weight, unit)} × ${best1RM.set.reps}`
                : "1 rep"
            }
            date={best1RM.date}
            onSelect={() => goToDate(best1RM.date)}
          />
          <HeadlineCard
            label="Heaviest"
            accent="amber"
            value={formatWeight(heaviest.set.weight, unit)}
            unit={unit}
            subtitle={`× ${heaviest.set.reps} reps`}
            date={heaviest.date}
            onSelect={() => goToDate(heaviest.date)}
          />
          <HeadlineCard
            label="Best Volume"
            accent="green"
            value={Math.round(
              fromKg(bestVolume.set.weight * bestVolume.set.reps, unit)
            ).toString()}
            unit={unit}
            subtitle={`${formatWeight(bestVolume.set.weight, unit)} × ${bestVolume.set.reps}`}
            date={bestVolume.date}
            onSelect={() => goToDate(bestVolume.date)}
          />
        </div>
      </div>

      {/* By set — pick a set number, see the max at every rep count performed */}
      <div className="rounded-2xl border border-white/10 bg-card/40 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            By Set
          </h3>
          <Dropdown
            value={scope}
            onChange={setScope}
            options={options}
            size="sm"
            align="end"
            className="w-40"
            ariaLabel="Select set number"
          />
        </div>

        <div className="mb-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {scope === "all" ? "All set positions" : `Set ${scope}`}
          </span>
          {scopeBest1RM > 0 && (
            <span className="font-mono tabular-nums">
              best 1RM ≈{" "}
              {roundForDisplay(fromKg(scopeBest1RM, unit), unit).toFixed(
                unit === "kg" ? 1 : 0
              )}{" "}
              {unit}
            </span>
          )}
          <span className="font-mono tabular-nums">{scoped.length} sets</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/5">
          {byReps.map((row, i) => (
            <div
              key={row.set.reps}
              className={
                "flex items-center justify-between gap-3 px-3 py-2.5 " +
                (i % 2 ? "bg-white/[.015]" : "bg-transparent")
              }
            >
              <span className="w-16 shrink-0 text-xs font-semibold text-primary/80">
                {row.set.reps} rep{row.set.reps === 1 ? "" : "s"}
              </span>
              <span className="flex flex-1 items-baseline gap-1">
                <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatWeight(row.set.weight, unit)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {unit}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatShort(row.date)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Reduce a list of sets to the single best (heaviest) entry at each rep count,
// returned sorted by rep count ascending. Only rep counts present appear.
function bestWeightPerRep(sets: Dated[]): Dated[] {
  const best = new Map<number, Dated>()
  for (const a of sets) {
    const cur = best.get(a.set.reps)
    if (!cur || a.set.weight > cur.set.weight) best.set(a.set.reps, a)
  }
  return [...best.values()].sort((x, y) => x.set.reps - y.set.reps)
}

function HeadlineCard({
  label,
  value,
  unit,
  subtitle,
  date,
  accent,
  onSelect,
}: {
  label: string
  value: string
  unit: string
  subtitle: string
  date: string
  accent: "primary" | "amber" | "green"
  onSelect: () => void
}) {
  const dotClass =
    accent === "primary"
      ? "bg-primary"
      : accent === "amber"
        ? "bg-[oklch(0.78_0.18_80)]"
        : "bg-[oklch(0.78_0.18_158)]"
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative w-full rounded-lg border border-white/5 bg-white/[.02] px-3 py-3 text-left transition-colors hover:border-white/15 hover:bg-white/[.05] focus:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <div className="flex items-center gap-1.5">
        <span className={"inline-block size-1.5 rounded-full " + dotClass} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <ChevronRight className="ml-auto size-3.5 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
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
    </button>
  )
}

function formatShort(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  })
}
