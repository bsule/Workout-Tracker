"use client"

import { useSyncExternalStore } from "react"
import type { TimerMark } from "@lift/core/restTimer"

// The last manual Reset timer / Stop timer from the set logger's "since last
// set" line: the web copy of mobile's restTimer mark. In memory only, never a
// set and never in the snapshot, so a reload falls back to the last logged
// set. It applies to every exercise on that workout date (core tickerAnchor),
// and the next saved set takes over again.

let mark: TimerMark | null = null
const listeners = new Set<() => void>()

function setMark(next: TimerMark | null) {
  mark = next
  for (const l of listeners) l()
}

export function getMark(): TimerMark | null {
  return mark
}

export function subscribeMark(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Restart the count from now on `date`'s workout without logging a set. */
export function resetTimer(date: string) {
  setMark({ kind: "reset", atMs: Date.now(), date })
}

/** Hide the ticker on `date`'s workout until the next saved set. */
export function stopTimer(date: string) {
  setMark({ kind: "stop", atMs: Date.now(), date })
}

/** Forget any reset or stop. Call on logout, so the signed-out user's mark
 *  cannot hide or move the next account's ticker. */
export function clearMark() {
  if (mark) setMark(null)
}

export function useTimerMark(): TimerMark | null {
  return useSyncExternalStore(subscribeMark, getMark, () => null)
}
