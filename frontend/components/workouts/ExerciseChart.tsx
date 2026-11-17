"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ExerciseHistoryDay } from "@/types"
import { cn } from "@/lib/utils"
import { useWeightUnit } from "@/components/settings/SettingsProvider"
import { niceDate, shortDate } from "@lift/core/format"
import {
  SET_INDEX_OPTIONS,
  defaultGraphMetric,
  graphDeltaText,
  graphEmptyMessage,
  graphHeaderLabel,
  graphMetricFor,
  graphMetricLabel,
  graphMetricOptions,
  graphPointDetail,
  graphPoints,
  graphValueParts,
  xLabelIndices,
  yAxisScale,
  type ChartPoint,
  type GraphMetric,
} from "@lift/core/exerciseStats"
import type { WeightUnit } from "@lift/core/units"

interface Props {
  history: ExerciseHistoryDay[]
  /** Cardio plots time and level metrics instead of the weight ones. */
  isCardio?: boolean
}

/** The Graph tab. Mirrors mobile's GraphPanel: the chart card, then the
 *  metric picker under it. */
export function ExerciseChart({ history, isCardio = false }: Props) {
  const unit = useWeightUnit()
  const [picked, setMetric] = useState<GraphMetric>(() => defaultGraphMetric(isCardio))
  const metric = graphMetricFor(picked, isCardio)
  const [setIndex, setSetIndex] = useState<number>(1)

  const points = useMemo(
    () => graphPoints(history, metric, setIndex, unit),
    [history, metric, setIndex, unit]
  )

  const metricLabel = graphMetricLabel(metric)
  const headerLabel = graphHeaderLabel(metric, setIndex)
  // The value and unit label for any number on the card: a weight in the
  // user's unit, a cardio clock with no unit, or a level.
  const show = (v: number | undefined) => graphValueParts(v, metric, unit)
  // One unit per metric, so the empty value's unit labels every number.
  const shownUnit = show(undefined).unit

  const metricPanel = (
    <div className="space-y-2">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-muted-foreground">
        Metric
      </div>
      <Segmented options={graphMetricOptions(isCardio)} value={metric} onChange={setMetric} />
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
        <div className="rounded-2xl border border-foreground/[.12] bg-background p-4">
          <ChartHeader label={headerLabel} value="-" unit={shownUnit} count={0} />
          <LegendRow label={metricLabel} right="-" />
          <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-foreground/10 px-4 text-center text-sm text-muted-foreground">
            {graphEmptyMessage(metric, setIndex)}
          </div>
          <StatsRow peak="-" avg="-" latest="-" unit={shownUnit} />
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
      <div className="rounded-2xl border border-foreground/[.12] bg-background p-4">
        <ChartHeader
          label={headerLabel}
          value={show(latest.value).value}
          unit={shownUnit}
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
                {graphDeltaText(delta, metric)} since first
              </span>
            ) : null
          }
        />
        <LegendRow label={metricLabel} right={niceDate(latest.date)} />
        <LineChart
          key={`${metric}-${setIndex}`}
          points={points}
          unit={unit}
          metric={metric}
          peak={peak}
          ariaLabel={`${metricLabel} over time`}
        />
        <StatsRow
          peak={show(peak).value}
          avg={show(avg).value}
          latest={show(latest.value).value}
          unit={shownUnit}
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
          {unit && <span className="text-xs uppercase text-muted-foreground">{unit}</span>}
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
    <div className="mt-3 flex gap-1.5 border-t border-foreground/[.06] pt-3">
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
    <div className="flex-1 rounded-lg border border-foreground/5 bg-foreground/[.02] px-2 py-2">
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
        {unit && <span className="text-[9px] uppercase text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

// Geometry, from mobile's SvgLineChart.
const POINT_SPACING = 58
const INITIAL = 18
const END = 18
// The Y axis is 42px wide, enough for every weight tick; a cardio clock past
// an hour ("1:15:00") widens it, about 6px a character at this size.
const Y_AXIS_MIN_W = 42
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
  metric,
  peak,
  ariaLabel,
}: {
  points: ChartPoint[]
  unit: WeightUnit
  metric: GraphMetric
  peak: number
  ariaLabel: string
}) {
  const { ticks: yTickValues, yMin, yMax } = yAxisScale(points.map((p) => p.value))
  const tickTexts = yTickValues.map((v) => graphValueParts(v, metric, unit).value)
  const Y_AXIS_W = Math.max(Y_AXIS_MIN_W, ...tickTexts.map((t) => t.length * 6 + 8))
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
  }, [Y_AXIS_W])

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
  const activeShown = graphValueParts(active?.value, metric, unit)
  const activeDetail = active ? graphPointDetail(active, metric) : null

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
            {tickTexts[i]}
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
              className="pointer-events-none absolute rounded-lg border border-foreground/10 bg-card px-2.5 py-1.5"
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
                {activeShown.unit
                  ? `${activeShown.value} ${activeShown.unit}`
                  : activeShown.value}
              </div>
              {activeDetail != null && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {activeDetail}
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
      className="flex gap-1 rounded-lg border border-foreground/10 bg-foreground/[.02] p-1"
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
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
