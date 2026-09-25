// Small workout rules both clients apply, lifted from the mobile screens so
// the web app follows the same ones.

import type { ExerciseHistoryDay, Workout } from "./types"

/**
 * True when a workout with no visible exercises holds nothing else worth
 * keeping: no start time, no gym, no session note, and not planned. The
 * screens treat such a workout as not existing yet, and the set logger
 * deletes it when the user backs out without logging. Keep the `notes` check:
 * a note-only workout must survive (see CLAUDE.md).
 */
export function isEmptyWorkoutShell(
  w: Pick<Workout, "started_at" | "gym" | "notes" | "status">
): boolean {
  return !w.started_at && !w.gym && !w.notes && w.status !== "planned"
}

/**
 * Heaviest set from the most recent prior workout for this exercise, used to
 * prefill the log-set form when there's nothing else to seed from. `history`
 * is newest first (getExerciseHistoryQ). Skips the current workout's date so
 * the previous session is what surfaces, and moves on to an older day when a
 * day has no weight x reps set.
 */
export function lastWorkoutTopSet(
  history: readonly ExerciseHistoryDay[],
  currentWorkoutDate: string | null
): { weight: number; reps: number } | null {
  for (const day of history) {
    if (currentWorkoutDate && day.date === currentWorkoutDate) continue
    const candidates = day.sets.filter(
      (s): s is typeof s & { weight: number; reps: number } =>
        s.weight != null && s.reps != null
    )
    if (candidates.length === 0) continue
    const top = candidates.reduce((b, s) => (s.weight > b.weight ? s : b))
    return { weight: top.weight, reps: top.reps }
  }
  return null
}

/**
 * The saved gym a typed name refers to, ignoring case, or undefined. Typing
 * "golds" when "Golds" is saved picks the saved gym: patching the typed text
 * would add a second gym that differs only in case.
 */
export function matchGymName(
  savedNames: readonly string[],
  typed: string
): string | undefined {
  const name = typed.trim().toLowerCase()
  return savedNames.find((g) => g.toLowerCase() === name)
}

/**
 * Why renaming gym `id` to `draft` is refused, or null when it may go ahead.
 * `"unchanged"` means the trimmed name is the same, so the caller just closes
 * the editor.
 */
export function gymRenameError(
  gyms: readonly { id?: number | null; name: string }[],
  id: number,
  draft: string
): string | "unchanged" | null {
  const trimmed = draft.trim()
  if (!trimmed) return "Name can't be empty."
  const current = gyms.find((g) => g.id === id)
  if (!current || trimmed === current.name) return "unchanged"
  const collision = gyms.some(
    (g) => g.id !== id && g.name.toLowerCase() === trimmed.toLowerCase()
  )
  if (collision) return "A gym with that name already exists."
  return null
}

/**
 * Why a new gym named `draft` is refused, or null when it may be added. A
 * name that matches a saved gym in any case is that gym ("golds" is "Golds"),
 * so it is refused rather than saved twice.
 */
export function gymAddError(
  gyms: readonly { name: string }[],
  draft: string
): string | null {
  const trimmed = draft.trim()
  if (!trimmed) return "Name can't be empty."
  if (matchGymName(gyms.map((g) => g.name), trimmed) != null) {
    return "A gym with that name already exists."
  }
  return null
}
