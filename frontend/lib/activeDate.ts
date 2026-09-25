"use client"

import { useSyncExternalStore } from "react"
import { todayString } from "@lift/core/dates"

/**
 * The date the user last viewed in the day view or picked on the calendar:
 * the web copy of mobile's ActiveDate context (mobile/src/state/activeDate.tsx).
 * It lives in sessionStorage, so it survives page navigations and reloads in
 * this tab and starts over at today in a new one, the way a mobile relaunch
 * does. `/workouts` opens it, and the calendar selects it by default.
 */
const KEY = "lift.activeDate"
const EVENT = "lift:active-date"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Stored as "<date>@<day it was set>". A tab left open overnight must not open
// yesterday's page from the Today link, the way a mobile relaunch starts at
// today: the stored date only counts on the day it was set.
function parse(raw: string | null): string | null {
  if (!raw) return null
  const [date, setOn] = raw.split("@")
  if (!DATE_RE.test(date) || setOn !== todayString()) return null
  return date
}

/** The stored date, or null when nothing (valid, set today) is stored. */
export function getActiveDate(): string | null {
  if (typeof window === "undefined") return null
  try {
    return parse(window.sessionStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function setActiveDate(date: string): void {
  if (typeof window === "undefined" || !DATE_RE.test(date)) return
  const value = `${date}@${todayString()}`
  try {
    if (window.sessionStorage.getItem(KEY) === value) return
    window.sessionStorage.setItem(KEY, value)
  } catch {
    // Private mode or quota: the active date is a convenience, not data.
    return
  }
  window.dispatchEvent(new Event(EVENT))
}

/** The stored date, falling back to today. */
export function activeDateOrToday(): string {
  return getActiveDate() ?? todayString()
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

/** The active date, or today when none is stored. Null during server render. */
export function useActiveDate(): string | null {
  return useSyncExternalStore(subscribe, activeDateOrToday, () => null)
}
