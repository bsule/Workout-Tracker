import { expect, it } from "vitest"
import { recomputePrsForExercise } from "@lift/core/store/prs"
import { weightKey } from "@lift/core/units"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

it("matches pairwise record rules across ties, positions, edits and deletions", () => {
  let seed = 42
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % max
  }
  const snap = blankSnapshot()
  snap.exercises = [exercise(1, "Bench")]
  for (let day = 0; day < 30; day++) {
    // Include multiple workout exercises on the same day and order ties.
    snap.workouts.push(workout(day + 1, `2026-01-${String(1 + Math.floor(day / 2)).padStart(2, "0")}`))
    snap.workout_exercises.push(we(day + 1, day + 1, 1, day % 2))
    for (let row = 0; row < 5; row++) {
      snap.sets.push(set(day * 5 + row + 1, day + 1, {
        weight: 50 + random(8) * 5 + random(2) * 0.0001,
        reps: 1 + random(12), order: Math.floor(row / 2),
        created_at: `2026-01-01T08:00:0${random(5)}.000Z`,
        is_planned: random(7) === 0,
      }))
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    const candidates = snap.sets.filter((s) => !s.is_planned && s.weight != null && s.reps != null)
    const prior = (a: typeof candidates[number], b: typeof a) => {
      const aw = snap.workout_exercises.find((w) => w.id === a.workout_exercise_id)!
      const bw = snap.workout_exercises.find((w) => w.id === b.workout_exercise_id)!
      const ad = snap.workouts.find((w) => w.id === aw.workout_id)!.date
      const bd = snap.workouts.find((w) => w.id === bw.workout_id)!.date
      return ad.localeCompare(bd) || aw.order - bw.order || a.order - b.order ||
        Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id
    }
    const position = new Map<number, number>()
    for (const w of snap.workout_exercises) {
      candidates.filter((s) => s.workout_exercise_id === w.id)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .forEach((s, i) => position.set(s.id, i))
    }
    const record = (s: typeof candidates[number], positional: boolean, historical: boolean) =>
      !candidates.some((o) => {
        if (o.id === s.id || (positional && position.get(o.id) !== position.get(s.id))) return false
        if (historical && prior(o, s) >= 0) return false
        const ow = weightKey(o.weight!)
        const sw = weightKey(s.weight!)
        return (ow > sw && o.reps! >= s.reps!) || (ow === sw && o.reps! > s.reps!) ||
          (ow === sw && o.reps === s.reps && prior(o, s) < 0)
      })
    const result = recomputePrsForExercise(snap, 1, { deriveHistorical: true })
    for (const s of result.sets) {
      const eligible = candidates.some((c) => c.id === s.id)
      expect([s.is_pr, s.is_position_pr, s.was_pr, s.was_position_pr]).toEqual([
        eligible && record(s, false, false), eligible && record(s, true, false),
        eligible && record(s, false, true), eligible && record(s, true, true),
      ])
    }
    snap.sets.splice(random(snap.sets.length), 1)
    snap.sets[random(snap.sets.length)].weight = 120 + pass
  }
})
