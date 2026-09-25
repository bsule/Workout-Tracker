"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ExerciseHistoryDay } from "@/types"
import { cn } from "@/lib/utils"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import { niceDate, shortDate } from "@lift/core/format"
import {
  METRIC_OPTIONS,
  SET_INDEX_OPTIONS,
  chartPoints,
  fmtMetric,
  graphEmptyMessage,
  graphHeaderLabel,
  xLabelIndices,
  yAxisScale,
  type ChartPoint,
  type Metric,
} from "@lift/core/exerciseStats"

interface Props {
  history: ExerciseHistoryDay[]
}

/** The Graph tab. Mirrors mobile's GraphPanel: the chart card, then the
 *  metric picker under it. */
export function ExerciseChart({ history }: Props) {
  const unit = useWeightUnit()
  const [metric, setMetric] = useState<Metric>("per_set")
  const [setIndex, setSetIndex] = useState<number>(1)

  const points = useMemo(
    () => chartPoints(history, metric, setIndex, unit),
    [history, metric, setIndex, unit]
  )

  const opt = METRIC_OPTIONS.find((m) => m.value === metric)!
  const headerLabel = graphHeaderLabel(metric, setIndex)

  const metricPanel = (
    <div className="space-y-2">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-muted-foreground">
        Metric
      </div>
      <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
      {metric === "per_set" && (
        <Segmented
          options={SET_INDEX_OPTIONS}
          value={setIndex}
          onChange={setSetIndex}
        />
      )}
    </div>
  )

  if (points.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-white/[.12] bg-background p-4">
          <ChartHeader label={headerLabel} value="-" unit={unit} count={0} />
          <LegendRow label={opt.label} right="-" />
          <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-white/10 px-4 text-center text-sm text-muted-foreground">
            {graphEmptyMessage(metric, setIndex)}
          </div>
          <StatsRow peak="-" avg="-" latest="-" unit={unit} />
        </div>
        {metricPanel}
      </div>
    )
  }

  const values = points.map((p) => p.value)
  const latest = points[points.length - 1]
  const first = points[0]
  const peak = Math.max(...values)
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  const delta = latest.value - first.value

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/[.12] bg-background p-4">
        <ChartHeader
          label={headerLabel}
          value={fmtMetric(latest.value)}
          unit={unit}
          count={points.length}
          delta={
            points.length > 1 ? (
              <span
                className={cn(
                  "text-[11px] font-bold",
                  delta > 0
                    ? "text-secondary"
                    : delta < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                {delta > 0 ? "+" : ""}
                {fmtMetric(delta)} since first
              </span>
            ) : null
          }
        />
        <LegendRow label={opt.label} right={niceDate(latest.date)} />
        <LineChart
          key={`${metric}-${setIndex}`}
          points={points}
          unit={unit}
          peak={peak}
          ariaLabel={`${opt.label} over time`}
        />
        <StatsRow
          peak={fmtMetric(peak)}
          avg={fmtMetric(avg)}
          latest={fmtMetric(latest.value)}
          unit={unit}
        />
      </div>
      {metricPanel}
    </div>
  )
}

function ChartHeader({
  label,
  value,
  unit,
  count,
  delta,
}: {
  label: string
  value: string
  unit: string
  count: number
  delta?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="font-mono text-2xl font-extrabold tabular-nums">
            {value}
          </span>
          <span className="text-xs uppercase text-muted-foreground">{unit}</span>
          {delta}
        </div>
      </div>
      <div className="text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {count} workout{count === 1 ? "" : "s"}
      </div>
    </div>
  )
}

function LegendRow({ label, right }: { label: string; right: string }) {
  return (
    <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full bg-primary" />
        {label}
      </span>
      <span>{right}</span>
    </div>
  )
}

function StatsRow({
  peak,
  avg,
  latest,
  unit,
}: {
  peak: string
  avg: string
  latest: string
  unit: string
}) {
  return (
    <div className="mt-3 flex gap-1.5 border-t border-white/[.06] pt-3">
      <Stat label="Peak" value={peak} unit={unit} dotClass="bg-secondary" />
      <Stat
        label="Average"
        value={avg}
        unit={unit}
        dotClass="bg-muted-foreground"
      />
      <Stat label="Latest" value={latest} unit={unit} dotClass="bg-primary" />
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  dotClass,
}: {
  label: string
  value: string
  unit: string
  dotClass: string
}) {
  return (
    <div className="flex-1 rounded-lg border border-white/5 bg-white/[.02] px-2 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn("inline-block size-1.5 rounded-full", dotClass)} />
        <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-sm font-extrabold tabular-nums">
          {value}
        </span>
        <span className="text-[9px] uppercase text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

// Geometry, from mobile's SvgLineChart.
const POINT_SPACING = 58
const INITIAL = 18
const END = 18
const Y_AXIS_W = 42
const CANVAS_H = 220
const TOP_PAD = 12
const BOT_PAD = 24
const DRAW_H = CANVAS_H - TOP_PAD - BOT_PAD
const BUBBLE_W = 110

/**
 * Points sit a fixed 58px apart, in a strip that scrolls sideways and opens
 * scrolled to the newest point. The Y axis stays put on the left. The latest
 * point starts selected; click a point to select it, click the background to
 * clear. Scrolling by hand selects the point nearest the middle, as dragging
 * the chart does on mobile.
 */
function LineChart({
  points,
  unit,
  peak,
  ariaLabel,
}: {
  points: ChartPoint[]
  unit: string
  peak: number
  ariaLabel: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const userScrollRef = useRef(false)
  const userScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrolledToEnd = useRef(false)
  const [visibleW, setVisibleW] = useState(0)
  const [activeIdx, setActiveIdx] = useState<number | null>(
    points.length > 0 ? points.length - 1 : null
  )

  // The strip's visible width is the card's inner width minus the Y axis.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setVisibleW(Math.max(0, el.clientWidth - Y_AXIS_W))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const naturalW = INITIAL + Math.max(0, points.length - 1) * POINT_SPACING + END
  const contentW = Math.max(visibleW, naturalW)

  // Open scrolled to the newest point, once the width is known.
  useLayoutEffect(() => {
    if (scrolledToEnd.current || visibleW === 0) return
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    scrolledToEnd.current = true
  }, [visibleW])

  const { ticks: yTickValues, yMin, yMax } = yAxisScale(points.map((p) => p.value))

  const xFor = (i: number) => {
    if (points.length === 1) return contentW / 2
    return INITIAL + (i * (contentW - INITIAL - END)) / (points.length - 1)
  }
  const yFor = (v: number) =>
    TOP_PAD + (1 - (v - yMin) / (yMax - yMin)) * DRAW_H

  let linePath = ""
  let areaPath = ""
  points.forEach((p, i) => {
    const x = xFor(i)
    const y = yFor(p.value)
    linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
    if (i === 0) areaPath += `M ${x} ${TOP_PAD + DRAW_H} L ${x} ${y}`
    else areaPath += ` L ${x} ${y}`
    if (i === points.length - 1) areaPath += ` L ${x} ${TOP_PAD + DRAW_H} Z`
  })

  const labelIndices = xLabelIndices(points.length)
  const active = activeIdx != null ? points[activeIdx] : null

  function markUserScroll() {
    userScrollRef.current = true
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
  }

  function onScroll() {
    if (!userScrollRef.current) return
    const el = scrollRef.current
    if (!el) return
    // Clear the flag once scrolling settles, so a later programmatic scroll
    // does not move the selection.
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
    userScrollTimer.current = setTimeout(() => {
      userScrollRef.current = false
    }, 150)
    const centerX = el.scrollLeft + visibleW / 2
    let closest = 0
    let minDist = Infinity
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(xFor(i) - centerX)
      if (d < minDist) {
        minDist = d
        closest = i
      }
    }
    if (closest !== activeIdx) setActiveIdx(closest)
  }

  return (
    <div ref={wrapRef} className="flex">
      <svg width={Y_AXIS_W} height={CANVAS_H} className="shrink-0" aria-hidden="true">
        {yTickValues.map((v, i) => (
          <text
            key={i}
            x={Y_AXIS_W - 6}
            y={yFor(v) + 3}
            fontSize={10}
            fontWeight={600}
            textAnchor="end"
            fill="var(--muted-foreground)"
          >
            {fmtMetric(v)}
          </text>
        ))}
      </svg>

      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ width: visibleW }}
        onScroll={onScroll}
        onWheel={markUserScroll}
        onTouchStart={markUserScroll}
        onPointerDown={markUserScroll}
      >
        <div
          className="relative"
          style={{ width: contentW, height: CANVAS_H }}
          onClick={() => setActiveIdx(null)}
        >
          <svg
            width={contentW}
            height={CANVAS_H}
            role="img"
            aria-label={ariaLabel}
            className="select-none"
          >
            <g>
              {yTickValues.map((v, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={contentW}
                  y1={yFor(v)}
                  y2={yFor(v)}
                  stroke="currentColor"
                  className="text-foreground"
                  strokeOpacity={0.06}
                  strokeWidth={1}
                />
              ))}
            </g>
            <path d={areaPath} fill="var(--primary)" fillOpacity={0.18} />
            <path d={linePath} stroke="var(--primary)" strokeWidth={2} fill="none" />
            {points.map((p, i) => {
              const isPeak = p.value === peak
              const isActive = activeIdx === i
              return (
                <g key={i}>
                  <circle
                    cx={xFor(i)}
                    cy={yFor(p.value)}
                    r={isActive ? 6.5 : isPeak ? 5 : 4}
                    fill={isPeak ? "var(--secondary)" : "var(--primary)"}
                  />
                  <circle
                    cx={xFor(i)}
                    cy={yFor(p.value)}
                    r={22}
                    fill="transparent"
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveIdx(i)
                    }}
                  />
                </g>
              )
            })}
            {labelIndices.map((i) => (
              <text
                key={`xl-${i}`}
                x={xFor(i)}
                y={CANVAS_H - 6}
                fontSize={10}
                fontWeight={600}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                pointerEvents="none"
              >
                {shortDate(points[i].date)}
              </text>
            ))}
            {active && activeIdx != null && (
              <line
                x1={xFor(activeIdx)}
                x2={xFor(activeIdx)}
                y1={TOP_PAD}
                y2={TOP_PAD + DRAW_H}
                stroke="currentColor"
                className="text-foreground"
                strokeOpacity={0.22}
                strokeWidth={1}
                pointerEvents="none"
              />
            )}
          </svg>

          {active && activeIdx != null && (
            <div
              className="pointer-events-none absolute rounded-lg border border-white/10 bg-card px-2.5 py-1.5"
              style={{
                width: BUBBLE_W,
                left: Math.min(
                  Math.max(xFor(activeIdx) - 55, 4),
                  contentW - 114
                ),
                top: Math.max(yFor(active.value) - 56, 4),
              }}
            >
              <div className="text-xs font-extrabold">
                {fmtMetric(active.value)} {unit}
              </div>
              {active.reps > 0 && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  × {active.reps} reps
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A row of equal-width buttons, one of which is active. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      className="flex gap-1 rounded-lg border border-white/10 bg-white/[.02] p-1"
      role="tablist"
    >
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-md px-1.5 py-2 text-[11px] font-bold transition-colors",
              active
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
