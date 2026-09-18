import type { ExerciseHistoryDay, HistorySet } from "@lift/core/types"

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
