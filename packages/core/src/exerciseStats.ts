// Pure History / Graph / Summary derivations shared by both clients, lifted
// from mobile's SetLoggerScreen (GraphPanel, SvgLineChart, SummaryPanel). Mobile
// is the reference: keep the rules here identical to it.

import type { ExerciseHistoryDay, HistorySet } from "./types"
import { fromKg, roundForDisplay, weightKey, type WeightUnit } from "./units"
import { estimateOneRm } from "./store/materialize"
import { todayString } from "./dates"
import { formatCardioTime } from "./setLogger"

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type Metric = "one_rm" | "heaviest" | "avg_weight" | "per_set"

export const METRIC_OPTIONS: {
  value: Metric
  label: string
}[] = [
  { value: "per_set", label: "Per Set" },
  { value: "heaviest", label: "Heaviest" },
  { value: "one_rm", label: "1RM" },
  { value: "avg_weight", label: "Avg Weight" },
]

export const SET_INDEX_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
]

/** One day's value for `metric`, in kg, with the reps behind it. Cardio sets
 *  (no weight/reps) are ignored; a day with none yields 0. */
export function dayValueKg(
  day: ExerciseHistoryDay,
  metric: Metric,
  setIndex: number
): { value: number; reps: number } {
  const sets = day.sets.filter(
    (s): s is typeof s & { weight: number; reps: number } =>
      s.weight != null && s.reps != null
  )
  if (!sets.length) return { value: 0, reps: 0 }
  switch (metric) {
    case "one_rm": {
      const best = sets.reduce((b, s) =>
        s.estimated_one_rm > b.estimated_one_rm ? s : b
      )
      return { value: best.estimated_one_rm, reps: best.reps }
    }
    case "heaviest": {
      const best = sets.reduce((b, s) => (s.weight > b.weight ? s : b))
      return { value: best.weight, reps: best.reps }
    }
    case "avg_weight": {
      const totalReps = sets.reduce((sum, s) => sum + s.reps, 0)
      return {
        value: sets.reduce((sum, s) => sum + s.weight, 0) / sets.length,
        reps: totalReps,
      }
    }
    case "per_set": {
      const target = sets[setIndex - 1]
      if (!target) return { value: 0, reps: 0 }
      return { value: target.weight, reps: target.reps }
    }
  }
}

export type ChartPoint = { date: string; value: number; reps: number }

/** The graph's points, oldest first, in the display unit and rounded the way
 *  the unit displays. Days with no value for the metric are dropped. */
export function chartPoints(
  days: ExerciseHistoryDay[],
  metric: Metric,
  setIndex: number,
  unit: WeightUnit
): ChartPoint[] {
  return days
    .map((d) => {
      const dv = dayValueKg(d, metric, setIndex)
      return {
        date: d.date,
        value: roundForDisplay(fromKg(dv.value, unit), unit),
        reps: dv.reps,
      }
    })
    .filter((p) => p.value > 0)
    .sort(
      (a, b) =>
        new Date(a.date + "T00:00:00").getTime() -
        new Date(b.date + "T00:00:00").getTime()
    )
}

function setIndexLabel(setIndex: number): string {
  return SET_INDEX_OPTIONS.find((s) => s.value === setIndex)!.label
}

// ---- cardio graph --------------------------------------------------------
//
// Cardio (by category, see isCardioCategory) stores minutes in `weight` and a
// level in `reps`, unconverted, so the weight metrics and the kg/lb unit mean
// nothing for it. It plots these instead.

export type CardioMetric = "total_time" | "longest" | "top_level"

/** Any metric the Graph tab can plot: a weight one or a cardio one. */
export type GraphMetric = Metric | CardioMetric

export const CARDIO_METRIC_OPTIONS: {
  value: CardioMetric
  label: string
}[] = [
  { value: "total_time", label: "Total time" },
  { value: "longest", label: "Longest" },
  { value: "top_level", label: "Top level" },
]

export function isCardioMetric(metric: GraphMetric): metric is CardioMetric {
  return metric === "total_time" || metric === "longest" || metric === "top_level"
}

/** The metric picker's options for the exercise. */
export function graphMetricOptions(isCardio: boolean): { value: GraphMetric; label: string }[] {
  return isCardio ? CARDIO_METRIC_OPTIONS : METRIC_OPTIONS
}

/** The metric the Graph tab opens on: Per Set, or Total time for cardio. */
export function defaultGraphMetric(isCardio: boolean): GraphMetric {
  return isCardio ? "total_time" : "per_set"
}

/** `metric` when it fits the exercise, else the exercise's default. Covers a
 *  picker state left over from before the exercise's category changed. */
export function graphMetricFor(metric: GraphMetric, isCardio: boolean): GraphMetric {
  return isCardioMetric(metric) === isCardio ? metric : defaultGraphMetric(isCardio)
}

/** A cardio set's time in minutes: the stored `weight`, or for an imported
 *  set with no weight its `time_seconds`. Null when it has neither. */
function cardioMinutes(s: HistorySet): number | null {
  if (s.weight != null) return s.weight
  if (s.time_seconds != null) return s.time_seconds / 60
  return null
}

/**
 * One cardio day's value for `metric`: total minutes, the longest set's
 * minutes (with its level in `reps`), or the highest level. A day with
 * nothing for the metric yields 0.
 */
export function cardioDayValue(
  day: ExerciseHistoryDay,
  metric: CardioMetric
): { value: number; reps: number } {
  switch (metric) {
    case "total_time": {
      let total = 0
      for (const s of day.sets) total += cardioMinutes(s) ?? 0
      return { value: total, reps: 0 }
    }
    case "longest": {
      let best: { value: number; reps: number } = { value: 0, reps: 0 }
      for (const s of day.sets) {
        const m = cardioMinutes(s)
        if (m == null) continue
        const level = s.reps ?? 0
        if (m > best.value || (m === best.value && level > best.reps)) {
          best = { value: m, reps: level }
        }
      }
      return best
    }
    case "top_level": {
      let top = 0
      for (const s of day.sets) if (s.reps != null && s.reps > top) top = s.reps
      return { value: top, reps: 0 }
    }
  }
}

/** The cardio graph's points, oldest first. Times are minutes rounded to the
 *  second; levels are as stored. Days with no value are dropped. */
export function cardioChartPoints(
  days: ExerciseHistoryDay[],
  metric: CardioMetric
): ChartPoint[] {
  return days
    .map((d) => {
      const dv = cardioDayValue(d, metric)
      const value = metric === "top_level" ? dv.value : Math.round(dv.value * 60) / 60
      return { date: d.date, value, reps: dv.reps }
    })
    .filter((p) => p.value > 0)
    .sort(
      (a, b) =>
        new Date(a.date + "T00:00:00").getTime() -
        new Date(b.date + "T00:00:00").getTime()
    )
}

/** The graph's points for any metric: chartPoints for a weight metric,
 *  cardioChartPoints for a cardio one. */
export function graphPoints(
  days: ExerciseHistoryDay[],
  metric: GraphMetric,
  setIndex: number,
  unit: WeightUnit
): ChartPoint[] {
  return isCardioMetric(metric)
    ? cardioChartPoints(days, metric)
    : chartPoints(days, metric, setIndex, unit)
}

/** The metric's name in the legend: "Per Set", "Total time", ... */
export function graphMetricLabel(metric: GraphMetric): string {
  return isCardioMetric(metric)
    ? CARDIO_METRIC_OPTIONS.find((m) => m.value === metric)!.label
    : METRIC_OPTIONS.find((m) => m.value === metric)!.label
}

/**
 * How a graph number shows: the value and the unit label beside it. Weight
 * metrics give fmtMetric and the weight unit; cardio times give a clock with
 * no unit ("20:30"); a level gives the plain number labeled "level". Missing
 * values show as "-". Axis ticks use `value` alone.
 */
export function graphValueParts(
  value: number | undefined,
  metric: GraphMetric,
  unit: WeightUnit
): { value: string; unit: string } {
  if (metric === "top_level") return { value: fmtMetric(value), unit: "level" }
  if (isCardioMetric(metric)) {
    return {
      value: value == null || !Number.isFinite(value) ? "-" : formatCardioTime(value),
      unit: "",
    }
  }
  return { value: fmtMetric(value), unit }
}

/** The "since first" change, signed: "+5", "-2.5", or "+5:00" for a time. */
export function graphDeltaText(delta: number, metric: GraphMetric): string {
  if (isCardioMetric(metric) && metric !== "top_level") return formatCardioTime(delta, true)
  return `${delta > 0 ? "+" : ""}${fmtMetric(delta)}`
}

/** The point bubble's second line: "× 5 reps", "× Lvl 5" for the longest
 *  cardio set, or null when the point has nothing to add. */
export function graphPointDetail(point: ChartPoint, metric: GraphMetric): string | null {
  if (point.reps <= 0) return null
  if (metric === "longest") return `× Lvl ${point.reps}`
  if (isCardioMetric(metric)) return null
  return `× ${point.reps} reps`
}

/** The chart card's eyebrow: "Heaviest set", "1st set", "1RM", ... */
export function graphHeaderLabel(metric: GraphMetric, setIndex: number): string {
  if (isCardioMetric(metric)) {
    return metric === "longest" ? "Longest set" : graphMetricLabel(metric)
  }
  const opt = METRIC_OPTIONS.find((m) => m.value === metric)!
  return metric === "heaviest"
    ? "Heaviest set"
    : metric === "per_set"
      ? `${setIndexLabel(setIndex)} set`
      : opt.label
}

/** What the empty chart card says when the metric has no points. */
export function graphEmptyMessage(metric: GraphMetric, setIndex: number): string {
  if (isCardioMetric(metric)) {
    return metric === "top_level" ? "No levels logged yet." : "No time logged yet."
  }
  const opt = METRIC_OPTIONS.find((m) => m.value === metric)!
  return metric === "per_set"
    ? `No ${setIndexLabel(setIndex)} sets logged yet.`
    : `No data for ${opt.label.toLowerCase()} yet.`
}

/** A graph number: whole values plain, others to one decimal, "-" when
 *  missing. */
export function fmtMetric(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-"
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

/** The Y axis for a set of values: a round step (5, 10, 25, 50, else a
 *  multiple of 100) from a quarter of the span, yMin floored to the step and
 *  never below 0, and one extra step on top when every value is equal. `ticks`
 *  run top to bottom. `values` must not be empty. */
export function yAxisScale(values: number[]): {
  step: number
  yMin: number
  yMax: number
  sections: number
  ticks: number[]
} {
  const SECTIONS = 4
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const rawSpan = Math.max(1, maxVal - minVal)
  const roughStep = rawSpan / SECTIONS
  const niceStep =
    roughStep <= 5
      ? 5
      : roughStep <= 10
        ? 10
        : roughStep <= 25
          ? 25
          : roughStep <= 50
            ? 50
            : Math.ceil(roughStep / 100) * 100
  const yMin = Math.max(0, Math.floor(minVal / niceStep) * niceStep)
  const yMax = Math.ceil(maxVal / niceStep) * niceStep + (maxVal === minVal ? niceStep : 0)
  const ySections = Math.max(1, Math.round((yMax - yMin) / niceStep))
  const ticks: number[] = []
  for (let s = 0; s <= ySections; s++) {
    ticks.push(yMax - s * niceStep)
  }
  return { step: niceStep, yMin, yMax, sections: ySections, ticks }
}

/** Which points get an x-axis date label: up to 5, spread evenly, always the
 *  first and the last. */
export function xLabelIndices(count: number): number[] {
  const labelIndices: number[] = []
  const labelCount = Math.min(5, count)
  for (let k = 0; k < labelCount; k++) {
    const denom = Math.max(1, labelCount - 1)
    labelIndices.push(Math.round((k * (count - 1)) / denom))
  }
  return labelIndices
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** The History tab's days: none after `currentDate` (a workout dated in the
 *  future can carry logged sets). */
export function pastDays(
  days: ExerciseHistoryDay[],
  currentDate: string
): ExerciseHistoryDay[] {
  return days.filter((d) => d.date <= currentDate)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * The Summary tab's "Last session": the newest day that is not after today
 * and, when `excludeDate` is set (the date being logged), strictly before it.
 * `days` is newest first, as getExerciseHistoryQ returns it.
 */
export function pickLastSession(
  days: ExerciseHistoryDay[],
  excludeDate?: string,
  today: string = todayString()
): ExerciseHistoryDay | null {
  for (const d of days) {
    // Never a session that has not happened yet. A workout dated in the
    // future can carry logged sets, and it sorts to the front; the History
    // tab drops those days for the same reason.
    if (d.date > today) continue
    if (excludeDate && d.date >= excludeDate) continue
    return d
  }
  return null
}

/** One weight x reps set, flattened with its set number (order + 1) and date. */
export type WrSet = {
  weightKg: number
  reps: number
  setNum: number
  date: string
  oneRm: number
}

/** Every weight x reps set across `days`. Cardio rows are skipped. */
export function weightRepSets(days: ExerciseHistoryDay[]): WrSet[] {
  const out: WrSet[] = []
  for (const day of days) {
    for (const s of day.sets) {
      if (s.weight == null || s.reps == null) continue
      out.push({
        weightKg: s.weight,
        reps: s.reps,
        setNum: s.order + 1,
        date: day.date,
        oneRm: s.estimated_one_rm,
      })
    }
  }
  return out
}

/** Set numbers actually performed, ascending. Never padded. */
export function setNumbersOf(sets: WrSet[]): number[] {
  const nums = new Set<number>()
  for (const s of sets) nums.add(s.setNum)
  return [...nums].sort((a, b) => a - b)
}

// How the rep-record rows are ordered, and what the bar in each row measures.
// The bar always tracks the active sort, so the list reads as one shape.
export type RepSort = "weight" | "oneRm" | "reps" | "recent"
export const REP_SORTS: { key: RepSort; label: string; hint: string }[] = [
  { key: "weight", label: "Heaviest", hint: "Top weight first" },
  { key: "oneRm", label: "Best 1RM", hint: "Strongest set first" },
  { key: "reps", label: "Most reps", hint: "Highest rep count first" },
  { key: "recent", label: "Recent", hint: "Newest record first" },
]

// Rows shown before the "Show all" toggle is tapped.
export const REP_ROWS_COLLAPSED = 3

export type RepRecordRow = {
  reps: number
  weightKg: number
  date: string
  count: number
  oneRmKg: number
  /** 0..1, what the row's bar measures: always the active sort. */
  share: number
  /** The single strongest row by estimated 1RM. */
  isTopOneRm: boolean
}

/**
 * One row per rep count actually performed in `scoped`: the heaviest weight at
 * that rep count, the day it happened, how many times that rep count was used,
 * and the 1RM it estimates to. Sorted by `sort`.
 */
export function repRecordRows(scoped: WrSet[], sort: RepSort): RepRecordRow[] {
  const best = new Map<
    number,
    { weightKg: number; date: string; count: number }
  >()
  for (const s of scoped) {
    const cur = best.get(s.reps)
    if (!cur) {
      best.set(s.reps, { weightKg: s.weightKg, date: s.date, count: 1 })
      continue
    }
    cur.count += 1
    if (weightKey(s.weightKg) > weightKey(cur.weightKg)) {
      cur.weightKg = s.weightKg
      cur.date = s.date
    }
  }
  const rows = [...best.entries()].map(([reps, v]) => ({
    reps,
    weightKg: v.weightKg,
    date: v.date,
    count: v.count,
    oneRmKg: estimateOneRm(v.weightKg, reps),
  }))

  // `metric` is what the bar measures: always the active sort, so the bar
  // lengths and the row order tell the same story. "Recent" has no useful
  // magnitude, so it falls back to weight.
  // Weight is measured as weightKey so equal-looking weights really tie and
  // the reps tiebreak below gets to decide. `share` is a ratio against
  // maxMetric, so the x100 scale cancels out and the bars are unaffected.
  const metric = (r: (typeof rows)[number]) =>
    sort === "reps"
      ? r.reps
      : sort === "oneRm"
        ? r.oneRmKg
        : weightKey(r.weightKg)

  rows.sort((a, b) => {
    if (sort === "recent") {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return weightKey(b.weightKg) - weightKey(a.weightKg)
    }
    const diff = metric(b) - metric(a)
    // Ties break on the harder set: more reps at the same weight.
    return diff !== 0 ? diff : b.reps - a.reps
  })

  const maxMetric = rows.reduce((m, r) => (metric(r) > m ? metric(r) : m), 0)

  // The single strongest row, by index rather than by value: several rep
  // counts can estimate to the same 1RM, and marking every tie made the
  // whole table gold. Ties go to the row that did more reps for it.
  let topIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (topIdx < 0) {
      topIdx = i
      continue
    }
    const best = rows[topIdx]
    if (rows[i].oneRmKg > best.oneRmKg) topIdx = i
    else if (rows[i].oneRmKg === best.oneRmKg && rows[i].reps > best.reps) {
      topIdx = i
    }
  }

  return rows.map((r, i) => ({
    ...r,
    share: maxMetric > 0 ? metric(r) / maxMetric : 0,
    isTopOneRm: i === topIdx,
  }))
}

// ---- cardio records ------------------------------------------------------
//
// Cardio's `WrSet`s carry minutes in `weightKg` and the level in `reps` (see
// weightRepSets), so the Summary tab's records become one row per level.

export type CardioSort = "longest" | "level" | "recent"
export const CARDIO_SORTS: { key: CardioSort; label: string; hint: string }[] = [
  { key: "longest", label: "Longest", hint: "Longest time first" },
  { key: "level", label: "Level", hint: "Highest level first" },
  { key: "recent", label: "Recent", hint: "Newest record first" },
]

/** Any record sort: a weight one or a cardio one. */
export type RecordSort = RepSort | CardioSort

/** The record sorts for the exercise. */
export function recordSorts(isCardio: boolean): { key: RecordSort; label: string; hint: string }[] {
  return isCardio ? CARDIO_SORTS : REP_SORTS
}

/** `sort` when it fits the exercise, else its first sort (Heaviest, or
 *  Longest for cardio). */
export function recordSortFor(sort: RecordSort, isCardio: boolean): RecordSort {
  return recordSorts(isCardio).some((o) => o.key === sort) ? sort : recordSorts(isCardio)[0].key
}

/** The Summary tab's records heading. */
export function recordsSectionTitle(isCardio: boolean): string {
  return isCardio ? "Level records" : "Rep records"
}

/** The records table's expand toggle: "Show all 6 rep counts" or, for
 *  cardio, "Show all 6 levels". */
export function showAllRecordsLabel(count: number, isCardio: boolean): string {
  return isCardio ? `Show all ${count} levels` : `Show all ${count} rep counts`
}

/**
 * Cardio's records: one row per level performed in `scoped`, the longest time
 * at that level, the day it happened and how many times the level was used.
 * Rows share RepRecordRow's shape so one table renders both: `reps` is the
 * level, `weightKg` the minutes, `oneRmKg` is 0 (cardio has no 1RM), and
 * `isTopOneRm` marks the single longest time (ties go to the higher level).
 */
export function cardioRecordRows(scoped: WrSet[], sort: CardioSort): RepRecordRow[] {
  // Times compare in whole seconds, so 20.5 typed and 20.50001 imported tie.
  const secs = (minutes: number) => Math.round(minutes * 60)
  const best = new Map<number, { minutes: number; date: string; count: number }>()
  for (const s of scoped) {
    const cur = best.get(s.reps)
    if (!cur) {
      best.set(s.reps, { minutes: s.weightKg, date: s.date, count: 1 })
      continue
    }
    cur.count += 1
    if (secs(s.weightKg) > secs(cur.minutes)) {
      cur.minutes = s.weightKg
      cur.date = s.date
    }
  }
  const rows = [...best.entries()].map(([level, v]) => ({
    reps: level,
    weightKg: v.minutes,
    date: v.date,
    count: v.count,
    oneRmKg: 0,
  }))

  // What the bar measures: the level for the Level sort, else the time.
  const metric = (r: (typeof rows)[number]) => (sort === "level" ? r.reps : secs(r.weightKg))

  rows.sort((a, b) => {
    if (sort === "recent") {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return secs(b.weightKg) - secs(a.weightKg) || b.reps - a.reps
    }
    if (sort === "level") return b.reps - a.reps
    return secs(b.weightKg) - secs(a.weightKg) || b.reps - a.reps
  })

  const maxMetric = rows.reduce((m, r) => (metric(r) > m ? metric(r) : m), 0)

  let topIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (topIdx < 0) {
      topIdx = i
      continue
    }
    const t = rows[topIdx]
    const d = secs(rows[i].weightKg) - secs(t.weightKg)
    if (d > 0 || (d === 0 && rows[i].reps > t.reps)) topIdx = i
  }

  return rows.map((r, i) => ({
    ...r,
    share: maxMetric > 0 ? metric(r) / maxMetric : 0,
    isTopOneRm: i === topIdx,
  }))
}

/** The record rows for the exercise: repRecordRows, or cardioRecordRows for
 *  cardio. A sort that does not fit the exercise falls back to its first. */
export function recordRows(scoped: WrSet[], sort: RecordSort, isCardio: boolean): RepRecordRow[] {
  const s = recordSortFor(sort, isCardio)
  return isCardio ? cardioRecordRows(scoped, s as CardioSort) : repRecordRows(scoped, s as RepSort)
}

// ---- history equality (was mobile/src/store/sameHistory.ts) -------------

// Field compare for two history sets. Lists every field a panel renders,
// so a change in any of them makes the arrays different.
function sameHistorySet(a: HistorySet, b: HistorySet): boolean {
  return (
    a.id === b.id &&
    a.weight === b.weight &&
    a.reps === b.reps &&
    a.distance_m === b.distance_m &&
    a.distance_unit_display === b.distance_unit_display &&
    a.time_seconds === b.time_seconds &&
    a.is_pr === b.is_pr &&
    a.was_pr === b.was_pr &&
    a.is_position_pr === b.is_position_pr &&
    a.was_position_pr === b.was_position_pr &&
    a.note === b.note &&
    a.order === b.order &&
    a.position === b.position &&
    a.estimated_one_rm === b.estimated_one_rm
  )
}

/**
 * True when two history arrays have the same content. getExerciseHistoryQ
 * rebuilds every object on each snapshot, so identity never matches across
 * store commits; this is what lets a memoized panel keep its old props when
 * a commit did not touch this exercise's history.
 */
export function sameHistory(
  a: ExerciseHistoryDay[],
  b: ExerciseHistoryDay[]
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const da = a[i]
    const db = b[i]
    if (da.date !== db.date || da.note !== db.note) return false
    if (da.sets.length !== db.sets.length) return false
    for (let j = 0; j < da.sets.length; j++) {
      if (!sameHistorySet(da.sets[j], db.sets[j])) return false
    }
  }
  return true
}
