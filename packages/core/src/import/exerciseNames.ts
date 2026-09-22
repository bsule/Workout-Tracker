import type { ExerciseRow } from "../store/schema"
import { SEED_EXERCISES } from "../store/seed"
import type { ExerciseKind } from "../types"

/**
 * One spelling per exercise name, for both importers: Unicode NFC (an accent
 * typed two ways is one name), whitespace runs collapsed, ends trimmed.
 */
export function normalizeExerciseName(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim()
}

function key(name: string): string {
  return normalizeExerciseName(name).toLowerCase()
}

/**
 * The lookup both importers use to turn an exercise name from a file into an
 * exercise row. Names match without regard to case or spacing.
 *
 * Built-in exercises are part of it. They are never rows in
 * `snapshot.exercises` (they ship in the bundle), so a lookup built from that
 * array alone turned every built-in name in a file, such as "Bench Press",
 * into a second, custom "Bench Press".
 *
 * `existing` is the snapshot's exercise rows, or [] in replace mode. It wins
 * over the built-ins, the same as mergeSeedAndCustom() in store/queries.ts:
 * - A row with a built-in's id is a user edit of that built-in (for example a
 *   rename). The built-in's original name then no longer matches.
 * - A custom row with a built-in's name keeps its matches, so a merge adds to
 *   the history the user already has instead of splitting one lift in two.
 *
 * Deleted rows never match: the exercise list hides them, and so would hide
 * the imported sets. A deleted built-in no longer matches either, so its
 * name makes a new custom exercise.
 *
 * A built-in matches only when the file's kind is the same, or the file has
 * none. Every non-cardio built-in is weight × reps, so a "Plank" logged as
 * time must not land on the built-in Plank, where its sets would show as
 * "- × -". It gets a custom exercise of its own kind instead. The user's own
 * rows are not kind-checked: they are the user's call.
 */
export class ExerciseLookup {
  private readonly byName = new Map<string, ExerciseRow>()
  private readonly builtins = new Set<ExerciseRow>()
  // Custom rows made beside a built-in of another kind, keyed name|kind.
  private readonly byNameKind = new Map<string, ExerciseRow>()

  constructor(existing: ExerciseRow[]) {
    const touched = new Set(existing.map((e) => e.id))
    for (const seed of SEED_EXERCISES) {
      if (touched.has(seed.id)) continue
      this.byName.set(key(seed.name), seed)
      this.builtins.add(seed)
    }
    for (const e of existing) {
      if (!e.is_deleted) this.byName.set(key(e.name), e)
    }
  }

  find(name: string, kind?: ExerciseKind): ExerciseRow | undefined {
    const k = key(name)
    const row = this.byName.get(k)
    if (row && kind && this.builtins.has(row) && row.kind !== kind) {
      return this.byNameKind.get(`${k}|${kind}`)
    }
    return row
  }

  /** Registers a row the import creates, so later rows of the file reuse it. */
  add(row: ExerciseRow): void {
    const k = key(row.name)
    const current = this.byName.get(k)
    if (current && this.builtins.has(current) && current.kind !== row.kind) {
      this.byNameKind.set(`${k}|${row.kind}`, row)
    } else {
      this.byName.set(k, row)
    }
  }
}

export function exerciseNameLookup(existing: ExerciseRow[]): ExerciseLookup {
  return new ExerciseLookup(existing)
}
