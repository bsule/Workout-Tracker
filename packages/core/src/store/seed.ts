import type { ExerciseRow } from "./schema"

// Bundled global exercises. These get a stable id space (1..N) and are
// referenced by `exercise_id` from workout_exercises. They are NOT written
// into the user's snapshot blob — the seed lives here in the bundle so it
// can be updated by shipping a new app version.
//
// `kind` is omitted here and inferred from `category` at materialize time
// (cardio → distance_time, everything else → weight_reps). Keeping it out
// of the table makes adding seed exercises a one-line change.

const GLOBAL: Array<Omit<ExerciseRow, "id" | "is_custom" | "kind">> = [
  // chest
  { name: "Bench Press", category: "chest" },
  { name: "Incline Bench Press", category: "chest" },
  { name: "Decline Bench Press", category: "chest" },
  { name: "Dumbbell Bench Press", category: "chest" },
  { name: "Incline Dumbbell Press", category: "chest" },
  { name: "Dumbbell Fly", category: "chest" },
  { name: "Cable Fly", category: "chest" },
  { name: "Push-Up", category: "chest" },
  { name: "Dip", category: "chest" },
  // back
  { name: "Deadlift", category: "back" },
  { name: "Pull-Up", category: "back" },
  { name: "Chin-Up", category: "back" },
  { name: "Lat Pulldown", category: "back" },
  { name: "Barbell Row", category: "back" },
  { name: "Dumbbell Row", category: "back" },
  { name: "Seated Cable Row", category: "back" },
  { name: "T-Bar Row", category: "back" },
  { name: "Face Pull", category: "back" },
  { name: "Shrug", category: "back" },
  // legs
  { name: "Back Squat", category: "legs" },
  { name: "Front Squat", category: "legs" },
  { name: "Romanian Deadlift", category: "legs" },
  { name: "Leg Press", category: "legs" },
  { name: "Leg Extension", category: "legs" },
  { name: "Leg Curl", category: "legs" },
  { name: "Lunge", category: "legs" },
  { name: "Bulgarian Split Squat", category: "legs" },
  { name: "Hip Thrust", category: "legs" },
  { name: "Calf Raise", category: "legs" },
  { name: "Goblet Squat", category: "legs" },
  // shoulders
  { name: "Overhead Press", category: "shoulders" },
  { name: "Dumbbell Shoulder Press", category: "shoulders" },
  { name: "Lateral Raise", category: "shoulders" },
  { name: "Front Raise", category: "shoulders" },
  { name: "Rear Delt Fly", category: "shoulders" },
  { name: "Arnold Press", category: "shoulders" },
  { name: "Upright Row", category: "shoulders" },
  // biceps
  { name: "Barbell Curl", category: "biceps" },
  { name: "Dumbbell Curl", category: "biceps" },
  { name: "Hammer Curl", category: "biceps" },
  { name: "Preacher Curl", category: "biceps" },
  { name: "Cable Curl", category: "biceps" },
  { name: "Concentration Curl", category: "biceps" },
  // triceps
  { name: "Tricep Pushdown", category: "triceps" },
  { name: "Overhead Tricep Extension", category: "triceps" },
  { name: "Skull Crusher", category: "triceps" },
  { name: "Close-Grip Bench Press", category: "triceps" },
  { name: "Tricep Kickback", category: "triceps" },
  { name: "Bench Dip", category: "triceps" },
  // abs
  { name: "Plank", category: "abs" },
  { name: "Crunch", category: "abs" },
  { name: "Sit-Up", category: "abs" },
  { name: "Hanging Leg Raise", category: "abs" },
  { name: "Russian Twist", category: "abs" },
  { name: "Cable Crunch", category: "abs" },
  { name: "Ab Rollout", category: "abs" },
  // cardio
  { name: "Treadmill", category: "cardio" },
  { name: "Stationary Bike", category: "cardio" },
  { name: "Rowing Machine", category: "cardio" },
  { name: "Elliptical", category: "cardio" },
  { name: "StairMaster", category: "cardio" },
  { name: "Jump Rope", category: "cardio" },
]

// Reserve ids 1..N for globals so custom exercises start at N+1.
export const SEED_EXERCISES: ExerciseRow[] = GLOBAL.map((e, i) => ({
  id: i + 1,
  name: e.name,
  category: e.category,
  kind: e.category === "cardio" ? "distance_time" : "weight_reps",
  is_custom: false,
}))

export const FIRST_CUSTOM_ID = SEED_EXERCISES.length + 1

export function isSeedId(id: number): boolean {
  return id >= 1 && id <= SEED_EXERCISES.length
}
