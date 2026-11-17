// TEMPORARY one-off repair, run by recomputeAllPrs (Settings, Recompute PRs).
// Remove this file and its call in mutations.ts once existing data is fixed.
// The Rust twin is crates/lift-domain/src/cardio_fix.rs.
//
// Custom cardio exercises made before cardio defaulted to distance_time were
// stored as weight_reps, so their minutes x level sets took PR stars. This
// switches them to distance_time and clears the stars on their sets. The PR
// pass skips non weight_reps exercises, so it would not clear them itself.

import type { Snapshot } from "./schema"

export function fixCustomCardioKinds(snap: Snapshot): Snapshot {
  const ids = new Set(
    snap.exercises
      .filter((e) => e.is_custom && e.category === "cardio" && e.kind === "weight_reps")
      .map((e) => e.id)
  )
  if (ids.size === 0) return snap
  const wes = new Set(
    snap.workout_exercises.filter((we) => ids.has(we.exercise_id)).map((we) => we.id)
  )
  return {
    ...snap,
    exercises: snap.exercises.map((e) => (ids.has(e.id) ? { ...e, kind: "distance_time" } : e)),
    sets: snap.sets.map((s) =>
      wes.has(s.workout_exercise_id) &&
      (s.is_pr || s.was_pr || s.is_position_pr || s.was_position_pr)
        ? { ...s, is_pr: false, was_pr: false, is_position_pr: false, was_position_pr: false }
        : s
    ),
  }
}
