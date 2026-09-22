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
