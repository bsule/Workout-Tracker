import type {
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
}

export function buildIndexes(snap: Snapshot): Indexes {
  const exerciseById = new Map<number, ExerciseRow>()
  for (const e of snap.exercises) exerciseById.set(e.id, e)

  const workoutById = new Map<number, WorkoutRow>()
  const workoutsByDate = new Map<string, WorkoutRow>()
  const workoutsByMonth = new Map<string, WorkoutRow[]>()
  for (const w of snap.workouts) {
    workoutById.set(w.id, w)
    workoutsByDate.set(w.date, w)
    // w.date is "YYYY-MM-DD" — slice to "YYYY-MM" for the month bucket.
    push(workoutsByMonth, w.date.slice(0, 7), w)
  }

  const workoutExercisesByWorkout = new Map<number, WorkoutExerciseRow[]>()
  const workoutExercisesByExercise = new Map<number, WorkoutExerciseRow[]>()
  const weById = new Map<number, WorkoutExerciseRow>()
  for (const we of snap.workout_exercises) {
    weById.set(we.id, we)
    push(workoutExercisesByWorkout, we.workout_id, we)
    push(workoutExercisesByExercise, we.exercise_id, we)
  }
  for (const list of workoutExercisesByWorkout.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  const setsByWorkoutExercise = new Map<number, SetRow[]>()
  for (const s of snap.sets) {
    push(setsByWorkoutExercise, s.workout_exercise_id, s)
  }
  for (const list of setsByWorkoutExercise.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  return {
    exerciseById,
    workoutById,
    workoutsByDate,
    workoutsByMonth,
    workoutExercisesByWorkout,
    workoutExercisesByExercise,
    weById,
    setsByWorkoutExercise,
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
