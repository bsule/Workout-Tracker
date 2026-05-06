import type {
  CalendarMap,
  Category,
  Exercise,
  ExerciseHistoryDay,
  Gym,
  Workout,
} from "@/types"
import {
  exerciseFromRow,
  exerciseLookup,
  historySetFromRow,
  workoutFromRow,
} from "./materialize"
import { getState } from "./store"
import { SEED_EXERCISES } from "./seed"
import type { ExerciseRow } from "./schema"

export function listExercisesQ(params?: {
  category?: Category
  q?: string
  sort?: "name" | "last_performed"
}): Exercise[] {
  const { snapshot, indexes } = getState()
  const all: ExerciseRow[] = mergeSeedAndCustom(snapshot.exercises)

  const filtered = all.filter((e) => {
    if (params?.category && e.category !== params.category) return false
    if (params?.q) {
      const q = params.q.toLowerCase()
      if (!e.name.toLowerCase().includes(q)) return false
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
  const { snapshot } = getState()
  const prefix = `${year}-${String(month).padStart(2, "0")}`
  const out: string[] = []
  for (const w of snapshot.workouts) {
    if (!w.date.startsWith(prefix + "-")) continue
    if (w.status === "planned") out.push(w.date)
  }
  return out
}

export function getCalendarQ(year: number, month: number): CalendarMap {
  const { snapshot, indexes } = getState()
  const prefix = `${year}-${String(month).padStart(2, "0")}`
  const out: CalendarMap = {}
  for (const w of snapshot.workouts) {
    if (!w.date.startsWith(prefix + "-")) continue
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
  const customIds = new Set(custom.map((e) => e.id))
  const out: ExerciseRow[] = []
  for (const seed of SEED_EXERCISES) {
    if (!customIds.has(seed.id)) out.push(seed)
  }
  out.push(...custom)
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
