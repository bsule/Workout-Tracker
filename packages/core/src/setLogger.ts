// Pure set-logger rules shared by both clients, lifted from mobile's
// SetLoggerScreen so the web logger behaves the same. No store access: the
// screens pass in what they already hold.

import type { Category, ExerciseHistoryDay, WorkoutSet } from "./types"
import { formatRest } from "./format"
import { formatWeight, type WeightUnit } from "./units"
import { lastWorkoutTopSet } from "./workouts"

/** Cardio exercises store time in minutes in `weight` and a level in `reps`,
 *  with no kg/lb conversion. Decided by the category, not the kind. */
export function isCardioCategory(category: Category | string | null | undefined): boolean {
  return category === "cardio"
}

/** The form's values when nothing seeds it: 0 x 8, or 20 min at Level 5. */
export const DEFAULT_REPS = 8
export const CARDIO_DEFAULT_MINUTES = 20
export const CARDIO_DEFAULT_LEVEL = 5

/**
 * What the log-set form starts with, in storage units (kg, or minutes for
 * cardio). In order: the next planned target (only when logging, not while
 * authoring a planned workout), the last set in the list, the top set of the
 * most recent earlier session (`history` newest first), then the defaults.
 * Weight and reps are seeded independently, like mobile.
 */
export function seedSetForm({
  sets,
  isPlanned,
  history,
  workoutDate,
  isCardio,
}: {
  sets: readonly Pick<WorkoutSet, "weight" | "reps" | "is_planned">[]
  isPlanned: boolean
  history: readonly ExerciseHistoryDay[]
  workoutDate: string | null
  isCardio: boolean
}): { weight: number; reps: number } {
  const nextPlanned = !isPlanned ? sets.find((s) => s.is_planned) ?? null : null
  const lastSet = sets.length ? sets[sets.length - 1] : null
  const seed = nextPlanned ?? lastSet
  let top: { weight: number; reps: number } | null | undefined
  const topSet = () => (top === undefined ? (top = lastWorkoutTopSet(history, workoutDate)) : top)
  const weight =
    seed?.weight != null
      ? seed.weight
      : topSet()?.weight ?? (isCardio ? CARDIO_DEFAULT_MINUTES : 0)
  const reps =
    seed?.reps != null
      ? seed.reps
      : topSet()?.reps ?? (isCardio ? CARDIO_DEFAULT_LEVEL : DEFAULT_REPS)
  return { weight, reps }
}

/** Why the form can't be saved, or null. `weight` is in the form's unit
 *  (minutes for cardio). */
export function setFormError(weight: number, reps: number, isCardio: boolean): string | null {
  if (reps <= 0) {
    return isCardio ? "Set a level of at least 1." : "Add at least 1 rep to log this set."
  }
  if (weight < 0) {
    return isCardio ? "Time can’t be negative." : "Weight can’t be negative."
  }
  if (isCardio && weight <= 0) return "Set a time of at least 1 minute."
  return null
}

/**
 * The timestamp a set's rest is measured from while editing it: the newest
 * logged (not planned) set before it in this exercise, else `fallbackIso`
 * (the other exercises' last set). Null means there is no rest to edit.
 */
export function restAnchorForEdit(
  sets: readonly Pick<WorkoutSet, "id" | "is_planned" | "created_at">[],
  setId: number,
  fallbackIso: string | null
): string | null {
  let anchor: string | null = fallbackIso
  for (const other of sets) {
    if (other.id === setId) break
    if (!other.is_planned) anchor = other.created_at
  }
  return anchor
}

/** Whole seconds of rest from `anchorIso` to `createdAtIso`, never negative
 *  and not capped. 0 with no anchor. Exactly mobile's rule, so an unparseable
 *  timestamp gives NaN rather than being papered over (created_at is always
 *  an ISO string the store wrote). */
export function restSecondsFrom(anchorIso: string | null, createdAtIso: string): number {
  if (!anchorIso) return 0
  return Math.max(0, Math.round((Date.parse(createdAtIso) - Date.parse(anchorIso)) / 1000))
}

/** The created_at that gives a set `restSec` of rest after `anchorIso`. */
export function createdAtForRest(anchorIso: string, restSec: number): string {
  return new Date(Date.parse(anchorIso) + restSec * 1000).toISOString()
}

/**
 * The 1-based position the next saved set takes. Planned sets and sets with
 * no weight x reps pair take no position (same filter as prs.ts). Sets in
 * `skipIds` are on their way out and do not count either.
 */
export function nextSetPosition(
  sets: readonly Pick<WorkoutSet, "id" | "weight" | "reps" | "is_planned">[],
  skipIds?: ReadonlySet<number>
): number {
  let logged = 0
  for (const s of sets) {
    if (s.is_planned || s.weight == null || s.reps == null) continue
    if (skipIds?.has(s.id)) continue
    logged++
  }
  return logged + 1
}

/** A tapped set whose store mutation has not landed yet. `baseIds` are the
 *  set ids the list held at the tap. */
export interface PendingSetAdd {
  key: number
  baseIds: ReadonlySet<number>
}

/**
 * Pair saved rows with the placeholders that stood in for them. A fast second
 * tap on Save queues a second placeholder before the first set lands, so the
 * rows new since the first tap (not in its `baseIds`) are taken in list order
 * and matched to the placeholders in tap order. Returns the matched pairs and
 * the placeholders still waiting for their row.
 */
export function matchPendingAdds<P extends PendingSetAdd>(
  sets: readonly Pick<WorkoutSet, "id">[],
  pending: readonly P[]
): { landed: [id: number, add: P][]; waiting: P[] } {
  if (pending.length === 0) return { landed: [], waiting: [] }
  const base = pending[0].baseIds
  const fresh = sets.filter((s) => !base.has(s.id))
  const landed: [number, P][] = []
  for (let i = 0; i < pending.length && i < fresh.length; i++) {
    landed.push([fresh[i].id, pending[i]])
  }
  return { landed, waiting: pending.slice(landed.length) }
}

/** Newest logged set time across a workout's exercises, skipping `skipWeId`.
 *  Anchors set 1's rest and the ticker before this exercise has a set. */
export function latestOtherSetIso(
  exercises: readonly { id: number; sets: readonly Pick<WorkoutSet, "is_planned" | "created_at">[] }[],
  skipWeId: number | null
): string | null {
  let latest: string | null = null
  for (const we of exercises) {
    if (skipWeId !== null && we.id === skipWeId) continue
    for (const s of we.sets) {
      if (s.is_planned) continue
      if (latest === null || Date.parse(s.created_at) > Date.parse(latest)) {
        latest = s.created_at
      }
    }
  }
  return latest
}

/** Per-row rest labels. Planned rows have synthetic timestamps, so they get
 *  none and never anchor the next row. Set 1 counts from `prevIso`. */
export function setRestLabels(
  sets: readonly Pick<WorkoutSet, "is_planned" | "created_at">[],
  prevIso: string | null
): (string | null)[] {
  const out: (string | null)[] = []
  let lastRealIso = prevIso
  for (const s of sets) {
    if (s.is_planned) {
      out.push(null)
      continue
    }
    out.push(formatRest(lastRealIso, s.created_at))
    lastRealIso = s.created_at
  }
  return out
}

/** Which PR badge a set row shows. Overall beats position; current beats
 *  historical. Planned rows show none. */
export function setPrBadge(
  s: Pick<WorkoutSet, "is_pr" | "was_pr" | "is_position_pr" | "was_position_pr" | "is_planned">,
  showPositionPrs: boolean
): { kind: "overall" | "position"; historical: boolean } | null {
  if (s.is_planned) return null
  if (s.is_pr) return { kind: "overall", historical: false }
  if (s.was_pr) return { kind: "overall", historical: true }
  if (!showPositionPrs) return null
  if (s.is_position_pr) return { kind: "position", historical: false }
  if (s.was_position_pr) return { kind: "position", historical: true }
  return null
}

/** The planned-set popup's title: "135 lb × 5", or "20 min × Lvl 5". */
export function plannedSetTitle(
  s: Pick<WorkoutSet, "weight" | "reps">,
  unit: WeightUnit,
  isCardio: boolean
): string {
  return isCardio
    ? `${s.weight ?? "-"} min × Lvl ${s.reps ?? "-"}`
    : `${formatWeight(s.weight ?? undefined, unit)} ${unit} × ${s.reps ?? "-"}`
}

/** "Delete 1 set?" / "Delete 3 sets?" */
export function deleteSetsTitle(count: number): string {
  return `Delete ${count} set${count === 1 ? "" : "s"}?`
}

/** A numeric field's typed text with anything invalid stripped: digits only,
 *  plus "." when decimals are allowed. */
export function cleanNumericText(text: string, allowDecimal: boolean): string {
  return text.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, "")
}

/** The most recent session before `currentDate` with a weight x reps set,
 *  and those sets. A future-dated session is not a "last time". */
export function lastSessionBefore(
  days: readonly ExerciseHistoryDay[],
  currentDate: string
): { date: string; sets: (ExerciseHistoryDay["sets"][number] & { weight: number; reps: number })[] } | null {
  for (const d of days) {
    if (d.date >= currentDate) continue
    const sets = d.sets.filter(
      (s): s is typeof s & { weight: number; reps: number } =>
        s.weight != null && s.reps != null
    )
    if (sets.length) return { date: d.date, sets }
  }
  return null
}

/** The Last time card's collapsed line: "135×5   135×5". */
export function lastSessionSummary(
  sets: readonly { weight: number; reps: number }[],
  unit: WeightUnit
): string {
  return sets.map((s) => `${formatWeight(s.weight, unit)}×${s.reps}`).join("   ")
}

/** Whether the Last time card is open. `manual` is the user's own choice
 *  (null until they touch it). Otherwise it follows the session: open in
 *  position mode, before the first set, or when there is no last session to
 *  collapse to. */
export function lastTimeCardOpen({
  manual,
  positionMode,
  hasSets,
  hasLast,
}: {
  manual: boolean | null
  positionMode: boolean
  hasSets: boolean
  hasLast: boolean
}): boolean {
  return manual ?? (positionMode || !hasSets || !hasLast)
}

/** History days on or before `date`: the ones the logger's History tab lists. */
export function historyDaysThrough(
  history: readonly ExerciseHistoryDay[],
  date: string
): number {
  let n = 0
  for (const d of history) if (d.date <= date) n++
  return n
}
