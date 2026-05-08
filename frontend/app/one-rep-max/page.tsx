"use client"

import { useMemo, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { estimateOneRm } from "@/lib/store"
import {
  defaultStep,
  formatWeight,
  fromKg,
  roundForDisplay,
  toKg,
} from "@/lib/units"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { useWeightUnit } from "@/components/settings/SettingsProvider"

const PERCENT_TABLE = [95, 90, 85, 80, 75, 70, 65, 60]

export default function OneRepMaxPage() {
  const unit = useWeightUnit()
  const step = defaultStep(unit)
  const [weight, setWeight] = useState<number>(unit === "kg" ? 60 : 135)
  const [reps, setReps] = useState<number>(5)

  const oneRmKg = useMemo(
    () => estimateOneRm(toKg(weight, unit), reps),
    [weight, reps, unit]
  )
  const oneRmDisplay = roundForDisplay(fromKg(oneRmKg, unit), unit)

  return (
    <PageWrapper>
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">1 Rep Max</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Estimates your single-rep max from a working set using the
            Epley/Brzycki blend.
          </p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-card/40 p-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Estimated 1RM
          </p>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="font-mono text-5xl font-extrabold tabular-nums text-foreground">
              {formatWeight(oneRmKg, unit)}
            </span>
            <span className="text-base font-semibold text-muted-foreground">
              {unit}
            </span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-card/40 p-5">
          <NumericField
            label="Weight"
            unit={unit}
            value={weight}
            step={step}
            min={0}
            onChange={setWeight}
          />
          <div className="h-4" />
          <NumericField
            label="Reps"
            value={reps}
            step={1}
            min={1}
            onChange={setReps}
          />
        </div>

        {oneRmDisplay > 0 && reps > 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-card/40 p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              % of 1RM
            </p>
            {PERCENT_TABLE.map((pct) => {
              const w = roundForDisplay((oneRmDisplay * pct) / 100, unit)
              return (
                <div
                  key={pct}
                  className="flex items-center border-b border-white/5 py-2 last:border-b-0"
                >
                  <span className="w-14 text-sm font-semibold text-muted-foreground">
                    {pct}%
                  </span>
                  <span className="flex-1 text-right font-mono text-base font-semibold tabular-nums">
                    {w}{" "}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {unit}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </PageWrapper>
  )
}

function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </label>
        {unit && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {unit}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 hover:border-white/20 hover:bg-white/[.06] active:translate-y-px transition-colors"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-5" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? n : 0)
          }}
          onFocus={(e) => e.target.select()}
          className="font-mono h-12 w-full flex-1 rounded-xl border border-white/10 bg-white/[.03] px-3 text-center text-3xl font-semibold tabular-nums tracking-tight focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={() => onChange(value + step)}
          className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-foreground/80 hover:border-white/20 hover:bg-white/[.06] active:translate-y-px transition-colors"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  )
}
