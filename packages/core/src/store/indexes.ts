import type {
  DayNoteRow,
  ExerciseRow,
  SetRow,
  Snapshot,
  WorkoutExerciseRow,
  WorkoutRow,
} from "./schema"

export interface Indexes {
  exerciseById: Map<number, ExerciseRow>
  workoutById: Map<number, WorkoutRow>
  workoutsByDate: Map<string, WorkoutRow>
  // Keyed by "YYYY-MM" — lets calendar/month queries skip the full workouts
  // scan when computing per-month dot/planned data.
  workoutsByMonth: Map<string, WorkoutRow[]>
  workoutExercisesByWorkout: Map<number, WorkoutExerciseRow[]>
  workoutExercisesByExercise: Map<number, WorkoutExerciseRow[]>
  weById: Map<number, WorkoutExerciseRow>
  setsByWorkoutExercise: Map<number, SetRow[]>
  dayNoteByDate: Map<string, DayNoteRow>
}

// Snapshot tables are immutable. Cache each table's indexes independently,
// so a set edit does not rebuild workout/calendar/exercise lookup tables.
// Weak keys allow old snapshots and their indexes to be garbage-collected.
const exerciseCache = new WeakMap<ExerciseRow[], Indexes["exerciseById"]>()
const workoutCache = new WeakMap<WorkoutRow[], Pick<Indexes,
  "workoutById" | "workoutsByDate" | "workoutsByMonth">>()
const weCache = new WeakMap<WorkoutExerciseRow[], Pick<Indexes,
  "workoutExercisesByWorkout" | "workoutExercisesByExercise" | "weById">>()
const setCache = new WeakMap<SetRow[], Indexes["setsByWorkoutExercise"]>()
const noteCache = new WeakMap<DayNoteRow[], Indexes["dayNoteByDate"]>()
const EMPTY_NOTES: DayNoteRow[] = []

export function buildIndexes(snap: Snapshot): Indexes {
  let exerciseById = exerciseCache.get(snap.exercises)
  if (!exerciseById) {
    exerciseById = new Map(snap.exercises.map((e) => [e.id, e]))
    exerciseCache.set(snap.exercises, exerciseById)
  }
  let workouts = workoutCache.get(snap.workouts)
  if (!workouts) {
    workouts = {
      workoutById: new Map(), workoutsByDate: new Map(), workoutsByMonth: new Map(),
    }
    for (const w of snap.workouts) {
      workouts.workoutById.set(w.id, w)
      workouts.workoutsByDate.set(w.date, w)
      push(workouts.workoutsByMonth, w.date.slice(0, 7), w)
    }
    workoutCache.set(snap.workouts, workouts)
  }
  let exercises = weCache.get(snap.workout_exercises)
  if (!exercises) {
    exercises = {
      workoutExercisesByWorkout: new Map(), workoutExercisesByExercise: new Map(), weById: new Map(),
    }
    for (const we of snap.workout_exercises) {
      exercises.weById.set(we.id, we)
      push(exercises.workoutExercisesByWorkout, we.workout_id, we)
      push(exercises.workoutExercisesByExercise, we.exercise_id, we)
    }
    for (const list of exercises.workoutExercisesByWorkout.values()) {
      list.sort((a, b) => a.order - b.order)
    }
    weCache.set(snap.workout_exercises, exercises)
  }
  let setsByWorkoutExercise = setCache.get(snap.sets)
  if (!setsByWorkoutExercise) {
    setsByWorkoutExercise = new Map()
    for (const s of snap.sets) push(setsByWorkoutExercise, s.workout_exercise_id, s)
    for (const list of setsByWorkoutExercise.values()) {
      list.sort((a, b) => a.order - b.order)
    }
    setCache.set(snap.sets, setsByWorkoutExercise)
  }
  const notes = snap.day_notes ?? EMPTY_NOTES
  let dayNoteByDate = noteCache.get(notes)
  if (!dayNoteByDate) {
    dayNoteByDate = new Map(notes.map((n) => [n.date, n]))
    noteCache.set(notes, dayNoteByDate)
  }
  return { exerciseById, ...workouts, ...exercises, setsByWorkoutExercise, dayNoteByDate }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
