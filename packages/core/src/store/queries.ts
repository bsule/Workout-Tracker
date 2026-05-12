import type {
  CalendarMap,
  Category,
  Exercise,
  ExerciseHistoryDay,
  Gym,
  Workout,
} from "../types"
import {
  exerciseFromRow,
  exerciseLookup,
  historySetFromRow,
  workoutFromRow,
} from "./materialize"
import { getState } from "./store"
import { SEED_EXERCISES, isSeedId } from "./seed"
import type { ExerciseRow } from "./schema"

/**
 * Min edit distance between `query` and any contiguous substring of `text`.
 * Free-start / free-end DP: row 0 is all zeros so the match can begin anywhere,
 * and we take the min of the final row so it can end anywhere.
 */
function fuzzySubstringDistance(text: string, query: string): number {
  const m = query.length
  const n = text.length
  if (m === 0) return 0
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const qc = query.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = text.charCodeAt(j - 1) === qc ? 0 : 1
      const sub = prev[j - 1] + cost
      const del = prev[j] + 1
      const ins = curr[j - 1] + 1
      curr[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins)
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  let best = prev[0]
  for (let j = 1; j <= n; j++) if (prev[j] < best) best = prev[j]
  return best
}

/**
 * Token-based fuzzy match. Splits the query on non-alphanumerics; every token
 * must fuzzy-match somewhere in `text` independently of order. Typo tolerance
 * scales with token length so short tokens stay strict.
 */
function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase()
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length === 0) return true
  for (const tok of tokens) {
    const threshold = tok.length <= 3 ? 0 : tok.length <= 5 ? 1 : 2
    if (fuzzySubstringDistance(t, tok) > threshold) return false
  }
  return true
}

export function listExercisesQ(params?: {
  category?: Category
  q?: string
  sort?: "name" | "last_performed"
}): Exercise[] {
  const { snapshot, indexes } = getState()
  const all: ExerciseRow[] = mergeSeedAndCustom(snapshot.exercises)

  const filtered = all.filter((e) => {
    if (e.is_deleted) return false
    if (params?.category && e.category !== params.category) return false
    if (params?.q) {
      if (!fuzzyMatch(e.name, params.q)) return false
    }
    return true
  })

  const today = todayString()
  const annotated = filtered.map((row) => {
    const wes = indexes.workoutExercisesByExercise.get(row.id) ?? []
    let count = 0
    let lastDate: string | null = null
    for (const we of wes) {
      const w = indexes.workoutById.get(we.workout_id)
      if (!w || w.status === "planned") continue
      const sets = indexes.setsByWorkoutExercise.get(we.id) ?? []
      const hasLogged = sets.some((s) => !s.is_planned)
      if (!hasLogged) continue
      count++
      if (!lastDate || w.date > lastDate) lastDate = w.date
    }
    const e = exerciseFromRow(row, row.id, indexes)
    e.workouts_count = count
    e.last_performed_days_ago = lastDate ? daysBetween(lastDate, today) : null
    return e
  })

  if (params?.sort === "last_performed") {
    annotated.sort((a, b) => {
      const ad = a.last_performed_days_ago
      const bd = b.last_performed_days_ago
      if (ad == null && bd == null) return a.name.localeCompare(b.name)
      if (ad == null) return 1
      if (bd == null) return -1
      return ad - bd
    })
  } else {
    annotated.sort((a, b) => a.name.localeCompare(b.name))
  }
  return annotated
}

export function getExerciseHistoryQ(id: number): ExerciseHistoryDay[] {
  const { indexes } = getState()
  const wes = indexes.workoutExercisesByExercise.get(id) ?? []
  const byDate = new Map<string, ExerciseHistoryDay>()
  for (const we of wes) {
    const w = indexes.workoutById.get(we.workout_id)
    if (!w || w.status === "planned") continue
    const sets = indexes.setsByWorkoutExercise.get(we.id) ?? []
    const histSets = sets
      .filter((s) => !s.is_planned)
      .sort((a, b) => a.order - b.order)
      .map(historySetFromRow)
    if (histSets.length === 0) continue
    const day = byDate.get(w.date)
    if (day) {
      day.sets.push(...histSets)
    } else {
      byDate.set(w.date, { date: w.date, sets: histSets })
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function listWorkoutsQ(params?: {
  date?: string
  month?: string
}): Workout[] {
  const { snapshot, indexes } = getState()
  let rows = snapshot.workouts
  if (params?.date) rows = rows.filter((w) => w.date === params.date)
  if (params?.month) {
    rows = rows.filter((w) => w.date.startsWith(params.month! + "-"))
  }
  return rows
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((w) => workoutFromRow(w, indexes))
}

export function getWorkoutQ(id: number): Workout | null {
  const { indexes } = getState()
  const row = indexes.workoutById.get(id)
  return row ? workoutFromRow(row, indexes) : null
}

export function getWorkoutByDateQ(date: string): Workout | null {
  const { indexes } = getState()
  const row = indexes.workoutsByDate.get(date)
  return row ? workoutFromRow(row, indexes) : null
}

export function getPlannedDatesQ(year: number, month: number): string[] {
  const { indexes } = getState()
  const key = `${year}-${String(month).padStart(2, "0")}`
  const monthWorkouts = indexes.workoutsByMonth.get(key)
  if (!monthWorkouts) return []
  const out: string[] = []
  for (const w of monthWorkouts) {
    if (w.status === "planned") out.push(w.date)
  }
  return out
}

export function getCalendarQ(year: number, month: number): CalendarMap {
  const { indexes } = getState()
  const key = `${year}-${String(month).padStart(2, "0")}`
  const monthWorkouts = indexes.workoutsByMonth.get(key)
  const out: CalendarMap = {}
  if (!monthWorkouts) return out
  for (const w of monthWorkouts) {
    const wes = indexes.workoutExercisesByWorkout.get(w.id) ?? []
    const cats: Category[] = []
    const seen = new Set<Category>()
    for (const we of wes) {
      const ex = exerciseLookup(we.exercise_id, indexes)
      if (!seen.has(ex.category)) {
        seen.add(ex.category)
        cats.push(ex.category)
      }
    }
    if (w.status === "planned" && cats.length === 0) {
      // Still surface a planned-day marker even with no exercises yet
      out[w.date] = []
      continue
    }
    if (cats.length === 0) {
      // Empty active/done workouts (e.g. "new workout" pressed but never used)
      // shouldn't earn a calendar marker — they just clutter the month view.
      continue
    }
    out[w.date] = cats
  }
  return out
}

export function listGymsQ(): Gym[] {
  const { snapshot } = getState()
  return snapshot.gyms.map((g) => ({ id: g.id, name: g.name }))
}

export function getPlannedWorkoutForToday(): Workout | null {
  const today = todayString()
  const w = getWorkoutByDateQ(today)
  if (w && w.status === "planned") return w
  return null
}

// helpers ------------------------------------------------------------

function mergeSeedAndCustom(custom: ExerciseRow[]): ExerciseRow[] {
  const overridesById = new Map(custom.map((e) => [e.id, e]))
  const out: ExerciseRow[] = []
  for (const seed of SEED_EXERCISES) {
    out.push(overridesById.get(seed.id) ?? seed)
  }
  out.push(...custom.filter((e) => !isSeedId(e.id)))
  return out
}

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00")
  const b = Date.parse(to + "T00:00:00")
  return Math.max(0, Math.round((b - a) / 86400000))
}
