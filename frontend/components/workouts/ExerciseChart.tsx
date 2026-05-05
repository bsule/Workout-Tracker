"use client"

import { useMemo, useRef, useState } from "react"
import type { ExerciseHistoryDay } from "@/types"
import { cn, parseLocalDate } from "@/lib/utils"

type Metric = "one_rm" | "heaviest" | "avg_weight" | "volume"

const METRIC_OPTIONS: {
  id: Metric
  label: string
  unit: string
  description: string
}[] = [
  { id: "one_rm", label: "Max 1RM", unit: "lb", description: "Best estimated 1-rep max" },
  { id: "heaviest", label: "Heaviest", unit: "lb", description: "Heaviest single set" },
  { id: "avg_weight", label: "Avg Weight", unit: "lb", description: "Average weight per set" },
  { id: "volume", label: "Volume", unit: "lb", description: "Sum of weight × reps" },
]

function dayValue(day: ExerciseHistoryDay, metric: Metric): number {
  if (!day.sets.length) return 0
  switch (metric) {
    case "one_rm":
      return day.sets.reduce(
        (m, s) => (s.estimated_one_rm > m ? s.estimated_one_rm : m),
        0
      )
    case "heaviest":
      return day.sets.reduce((m, s) => (s.weight > m ? s.weight : m), 0)
    case "avg_weight":
      return (
        day.sets.reduce((sum, s) => sum + s.weight, 0) / day.sets.length
      )
    case "volume":
      return day.sets.reduce((sum, s) => sum + s.weight * s.reps, 0)
  }
}

interface Props {
  history: ExerciseHistoryDay[]
}

export function ExerciseChart({ history }: Props) {
  const [metric, setMetric] = useState<Metric>("one_rm")
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const points = useMemo(() => {
    return history
      .map((d) => ({ date: d.date, value: dayValue(d, metric) }))
      .filter((p) => p.value > 0)
  }, [history, metric])

  const opt = METRIC_OPTIONS.find((m) => m.id === metric)!

  if (points.length === 0) {
    return (
      <div className="space-y-3">
        <MetricSwitcher metric={metric} onChange={setMetric} />
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[.01] p-10 text-center text-sm text-muted-foreground">
          No data yet. Log a few sets and the chart will fill in.
        </div>
      </div>
    )
  }

  const W = 600
  const H = 260
  const PAD_L = 48
  const PAD_R = 12
  const PAD_T = 16
  const PAD_B = 32

  const minVal = Math.min(...points.map((p) => p.value))
  const maxVal = Math.max(...points.map((p) => p.value))
  const headroom = Math.max(5, (maxVal - minVal) * 0.1)
  const yMin = Math.floor(Math.max(0, minVal - headroom))
  const yMax = Math.ceil(maxVal + headroom)
  const ySpan = yMax - yMin || 1

  const xs = points.map((p) => parseLocalDate(p.date).getTime())
  const tMin = Math.min(...xs)
  const tMax = Math.max(...xs)
  const tSpan = tMax - tMin || 1

  function x(t: number) {
    if (points.length === 1) return (PAD_L + (W - PAD_R)) / 2
    return PAD_L + ((t - tMin) / tSpan) * (W - PAD_L - PAD_R)
  }
  function y(v: number) {
    return PAD_T + (1 - (v - yMin) / ySpan) * (H - PAD_T - PAD_B)
  }

  const positioned = points.map((p) => ({
    ...p,
    cx: x(parseLocalDate(p.date).getTime()),
    cy: y(p.value),
  }))

  const path = positioned
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`)
    .join(" ")

  // Stats summary
  const sum = points.reduce((s, p) => s + p.value, 0)
  const avg = sum / points.length
  const peak = Math.max(...points.map((p) => p.value))

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = yMin + (ySpan * i) / ticks
    return { v, y: y(v) }
  })

  const xLabels: { date: string; x: number }[] = []
  if (points.length === 1) {
    xLabels.push({ date: points[0].date, x: positioned[0].cx })
  } else {
    xLabels.push({ date: points[0].date, x: positioned[0].cx })
    if (points.length > 2) {
      const midI = Math.floor(points.length / 2)
      xLabels.push({ date: points[midI].date, x: positioned[midI].cx })
    }
    xLabels.push({
      date: points[points.length - 1].date,
      x: positioned[points.length - 1].cx,
    })
  }

  // Average reference line (only when 2+ points)
  const avgY = y(avg)

  const last = positioned[positioned.length - 1]
  const first = positioned[0]
  const delta = last.value - first.value

  const display =
    hoverIdx != null && positioned[hoverIdx] ? positioned[hoverIdx] : last

  function pointFromEvent(clientX: number) {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const localX = ((clientX - rect.left) / rect.width) * W
    let bestI = 0
    let bestDist = Infinity
    for (let i = 0; i < positioned.length; i++) {
      const d = Math.abs(positioned[i].cx - localX)
      if (d < bestDist) {
        bestDist = d
        bestI = i
      }
    }
    return bestI
  }

  function fmt(v: number) {
    if (metric === "volume") return v.toFixed(0)
    return v.toFixed(1)
  }

  return (
    <div className="space-y-3">
      <MetricSwitcher metric={metric} onChange={setMetric} />

      <div className="rounded-2xl border border-white/10 bg-card/40 p-4 sm:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {hoverIdx != null ? `Selected ${opt.label}` : opt.label}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tabular-nums">
                {fmt(display.value)}
              </span>
              <span className="text-xs text-muted-foreground">{opt.unit}</span>
              {hoverIdx == null && points.length > 1 && (
                <span
                  className={
                    "ml-2 text-xs font-medium " +
                    (delta > 0
                      ? "text-emerald-400"
                      : delta < 0
                        ? "text-destructive"
                        : "text-muted-foreground")
                  }
                >
                  {delta > 0 ? "+" : ""}
                  {fmt(delta)} since first
                </span>
              )}
              {hoverIdx != null && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {parseLocalDate(positioned[hoverIdx].date).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", year: "numeric" }
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">
            {points.length} workout{points.length === 1 ? "" : "s"}
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto touch-none select-none"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${opt.label} over time`}
          onMouseMove={(e) => {
            const i = pointFromEvent(e.clientX)
            if (i != null) setHoverIdx(i)
          }}
          onMouseLeave={() => setHoverIdx(null)}
          onTouchStart={(e) => {
            const t = e.touches[0]
            if (t) {
              const i = pointFromEvent(t.clientX)
              if (i != null) setHoverIdx(i)
            }
          }}
          onTouchMove={(e) => {
            const t = e.touches[0]
            if (t) {
              const i = pointFromEvent(t.clientX)
              if (i != null) setHoverIdx(i)
            }
          }}
          onTouchEnd={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={t.y}
                y2={t.y}
                stroke="oklch(1 0 0 / 0.06)"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={t.y + 3}
                textAnchor="end"
                fontSize="10"
                fill="oklch(0.74 0 0)"
                fontFamily="var(--font-mono)"
              >
                {fmt(t.v)}
              </text>
            </g>
          ))}

          {/* Average reference line */}
          {points.length > 1 && (
            <g>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={avgY}
                y2={avgY}
                stroke="oklch(0.78 0.18 158 / 0.55)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <text
                x={W - PAD_R - 4}
                y={avgY - 4}
                textAnchor="end"
                fontSize="9"
                fill="oklch(0.78 0.18 158)"
                fontFamily="var(--font-mono)"
              >
                avg {fmt(avg)}
              </text>
            </g>
          )}

          {points.length > 1 && (
            <path
              d={`${path} L${(W - PAD_R).toFixed(1)},${(H - PAD_B).toFixed(1)} L${PAD_L.toFixed(1)},${(H - PAD_B).toFixed(1)} Z`}
              fill="url(#chartFill)"
            />
          )}

          {points.length > 1 && (
            <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
          )}

          {positioned.map((p, i) => {
            const isActive = hoverIdx === i
            const isPeak = p.value === peak
            return (
              <g key={i}>
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={isActive ? 5 : isPeak ? 4 : 3.5}
                  fill={isPeak ? "oklch(0.78 0.18 80)" : "var(--primary)"}
                />
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={isActive ? 10 : 6}
                  fill={isPeak ? "oklch(0.78 0.18 80)" : "var(--primary)"}
                  opacity={isActive ? 0.25 : 0.15}
                />
              </g>
            )
          })}

          {hoverIdx != null && positioned[hoverIdx] && (() => {
            const p = positioned[hoverIdx]
            const dateLabel = parseLocalDate(p.date).toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" }
            )
            const tipText = `${fmt(p.value)} ${opt.unit} · ${dateLabel}`
            const charW = 6.2
            const tipW = tipText.length * charW + 16
            const tipH = 22
            let tipX = p.cx - tipW / 2
            tipX = Math.max(PAD_L, Math.min(W - PAD_R - tipW, tipX))
            const tipY = Math.max(PAD_T, p.cy - tipH - 10)
            return (
              <g pointerEvents="none">
                <line
                  x1={p.cx}
                  x2={p.cx}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="oklch(1 0 0 / 0.18)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <rect
                  x={tipX}
                  y={tipY}
                  width={tipW}
                  height={tipH}
                  rx={6}
                  fill="oklch(0.13 0 0)"
                  stroke="oklch(1 0 0 / 0.12)"
                />
                <text
                  x={tipX + tipW / 2}
                  y={tipY + 14}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="oklch(0.97 0 0)"
                >
                  {tipText}
                </text>
              </g>
            )
          })()}

          {hoverIdx == null &&
            xLabels.map((l, i) => (
              <text
                key={i}
                x={l.x}
                y={H - 8}
                textAnchor="middle"
                fontSize="10"
                fill="oklch(0.74 0 0)"
                fontFamily="var(--font-mono)"
              >
                {parseLocalDate(l.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            ))}
        </svg>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/5 pt-3">
          <Stat label="Peak" value={fmt(peak)} unit={opt.unit} accent="amber" />
          <Stat label="Average" value={fmt(avg)} unit={opt.unit} accent="green" />
          <Stat
            label="Latest"
            value={fmt(last.value)}
            unit={opt.unit}
            accent="primary"
          />
        </div>
      </div>
    </div>
  )
}

function MetricSwitcher({
  metric,
  onChange,
}: {
  metric: Metric
  onChange: (m: Metric) => void
}) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[.02] p-1 sm:grid-cols-4"
      role="tablist"
    >
      {METRIC_OPTIONS.map((m) => {
        const active = m.id === metric
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            title={m.description}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-white/10 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
                : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: string
  unit: string
  accent: "amber" | "green" | "primary"
}) {
  const dotClass =
    accent === "amber"
      ? "bg-[oklch(0.78_0.18_80)]"
      : accent === "green"
        ? "bg-[oklch(0.78_0.18_158)]"
        : "bg-primary"
  return (
    <div className="rounded-lg border border-white/5 bg-white/[.02] px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn("inline-block size-1.5 rounded-full", dotClass)} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-base font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
