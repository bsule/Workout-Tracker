// Pure rules for the rest timer outside the app (iOS Live Activity, Android
// ongoing notification). No native or store access, so tests/ can import it.

import type { UserSettings } from "@lift/core"

export const CUTOFF_DEFAULT_S = 360
export const CUTOFF_MIN_S = 30
export const CUTOFF_MAX_S = 900

export interface RestTimerSettings {
  enabled: boolean
  cutoffS: number
}

/** Reads the two settings with their defaults. A stored cutoff outside the
 *  valid range (hand-edited import, older client) is clamped, not trusted. */
export function restTimerSettings(
  s: Pick<UserSettings, "rest_timer_activity" | "rest_timer_cutoff_s">
): RestTimerSettings {
  const raw = s.rest_timer_cutoff_s
  return {
    enabled: s.rest_timer_activity ?? true,
    cutoffS:
      typeof raw === "number" && Number.isFinite(raw)
        ? clampCutoff(raw)
        : CUTOFF_DEFAULT_S,
  }
}

export function clampCutoff(s: number): number {
  return Math.min(CUTOFF_MAX_S, Math.max(CUTOFF_MIN_S, Math.round(s)))
}

/**
 * Parses what the user typed in the "Hide timer after" field.
 * "6" is minutes. "6:30", "06:30" and "0:45" are minutes and seconds.
 * Returns seconds, or null when the text is not a time. It does not clamp:
 * the caller decides whether 20:00 is an error or a clamp.
 */
export function parseCutoff(text: string): number | null {
  const t = text.trim()
  const minsOnly = /^(\d{1,2})$/.exec(t)
  if (minsOnly) return Number(minsOnly[1]) * 60
  const minsSecs = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!minsSecs) return null
  const secs = Number(minsSecs[2])
  if (secs > 59) return null
  return Number(minsSecs[1]) * 60 + secs
}

/** 390 → "6:30", 360 → "6:00". */
export function formatCutoff(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, "0")}`
}

export type RestTimerAction = "start" | "update" | "end" | "none"

/**
 * What to do when a set is saved. `running` is the timer this process last
 * showed, or null. A timer still inside its cutoff is updated in place, so
 * the Dynamic Island does not play its start animation again.
 */
export function decideOnSet(
  running: { endsAt: number } | null,
  now: number,
  enabled: boolean
): RestTimerAction {
  if (!enabled) return running ? "end" : "none"
  if (running && now < running.endsAt) return "update"
  return "start"
}

/**
 * What to do when the app returns to the foreground. iOS cannot run our code
 * while the app is suspended, so a timer past its cutoff can still be on the
 * Lock Screen. `shown` is the timer the OS reports as on screen, which can
 * come from an earlier process (the OS may kill a suspended app mid-rest).
 * A timer inside its cutoff is left alone: the user is still resting.
 */
export function decideOnForeground(
  shown: { endsAt: number } | null,
  now: number,
  enabled: boolean
): "end" | "none" {
  if (!shown) return "none"
  if (!enabled) return "end"
  return now >= shown.endsAt ? "end" : "none"
}

/** A manual reset or stop from the "since last set" menu. Device-local and
 *  in memory only: it is never a set and never enters the snapshot. `date`
 *  is the workout day (YYYY-MM-DD) it was made on; other days ignore it. */
export interface TimerMark {
  kind: "reset" | "stop"
  atMs: number
  date: string
}

/**
 * What the in-app "since last set" ticker counts from on the workout for
 * `date`. `setAnchorMs` is the last logged set (or null). A mark made on
 * another day is ignored, so a reset today does not start a count on an old
 * workout. A set saved after the mark wins, so the next real set takes over
 * as usual. Otherwise a reset counts from the reset, and a stop hides the
 * ticker (null).
 */
export function tickerAnchor(
  setAnchorMs: number | null,
  mark: TimerMark | null,
  date: string | null
): number | null {
  if (!mark || mark.date !== date) return setAnchorMs
  if (setAnchorMs != null && setAnchorMs > mark.atMs) return setAnchorMs
  return mark.kind === "reset" ? mark.atMs : null
}

/**
 * The last logged set the "since last set" ticker counts from, before any
 * manual reset or stop (tickerAnchor applies that). In order:
 * - `pendingAddMs`: a set the user just saved whose row has not landed yet;
 * - the newest logged row in `sets` (planned rows carry a synthetic
 *   created_at and never anchor rest);
 * - `fallbackIso`: the latest logged set of another exercise in the same
 *   workout, so the ticker keeps running when the user switches exercises
 *   before logging anything on the new one.
 */
export function lastSetAnchorMs({
  pendingAddMs,
  sets,
  fallbackIso,
}: {
  pendingAddMs: number | null
  sets: readonly { is_planned?: boolean; created_at: string }[]
  fallbackIso: string | null
}): number | null {
  if (pendingAddMs != null) return pendingAddMs
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i]
    if (s.is_planned) continue
    const parsed = Date.parse(s.created_at)
    // Only the newest logged row counts: an unreadable timestamp there means
    // no anchor from this exercise, not a fall-through to an older row.
    if (Number.isFinite(parsed)) return parsed
    break
  }
  if (!fallbackIso) return null
  const parsed = Date.parse(fallbackIso)
  return Number.isFinite(parsed) ? parsed : null
}
