// The only code that drives the rest timer outside the app. Callers fire and
// forget: nothing here blocks, throws, or slows down saving a set.

import { PermissionsAndroid, Platform } from "react-native"
import { getState } from "@lift/core"
import { isRestTimerAvailable, restTimerBridge } from "./bridge"
import {
  decideOnForeground,
  decideOnSet,
  restTimerSettings,
  type TimerMark,
} from "./plan"

/** The timer this process last showed. Null until the first set or the
 *  first reconcile(), which reads what the OS still has on screen. */
let shown: { endsAt: number } | null = null

// One native call at a time, in order. Two quick saves must not race a
// start against an update.
let queue: Promise<void> = Promise.resolve()
function enqueue(task: () => Promise<void>) {
  if (!isRestTimerAvailable()) return
  queue = queue.then(task).catch((e) => {
    console.warn("[restTimer]", e instanceof Error ? e.message : e)
    // A failed call leaves the screen state unknown. Forget it, so the next
    // set starts fresh instead of updating a timer that is not there.
    shown = null
  })
}

function settings() {
  return restTimerSettings(getState().snapshot.settings)
}

/** Call when a set is saved (not edited). `atMs` must match the time the
 *  in-app ticker counts from, so the two agree to the second. */
export function setLogged(exerciseName: string, atMs: number) {
  enqueue(() => showFrom(exerciseName, atMs))
}

async function showFrom(exerciseName: string, atMs: number) {
  const { enabled, cutoffS } = settings()
  const action = decideOnSet(shown, Date.now(), enabled)
  if (action === "none") return
  if (action === "end") {
    shown = null
    await restTimerBridge.end()
    return
  }
  if (!(await notificationsAllowed())) return
  const input = { exerciseName, startedAt: atMs, endsAt: atMs + cutoffS * 1000 }
  if (action === "update") await restTimerBridge.update(input)
  else await restTimerBridge.start(input)
  shown = { endsAt: input.endsAt }
}

// The last manual reset or stop, for the in-app ticker (plan.ts tickerAnchor).
// Held in memory only: a relaunch falls back to the last logged set.
let mark: TimerMark | null = null
const markListeners = new Set<() => void>()

function setMark(next: TimerMark | null) {
  mark = next
  for (const l of markListeners) l()
}

/** For useSyncExternalStore. */
export function getMark(): TimerMark | null {
  return mark
}

export function subscribeMark(listener: () => void): () => void {
  markListeners.add(listener)
  return () => markListeners.delete(listener)
}

/** Forget a manual reset or stop. Call on sign-out, so the signed-out
 *  user's mark cannot hide or move the next account's ticker. */
export function clearMark() {
  if (mark) setMark(null)
}

/** Restart the count from now, in the app and outside it, without logging
 *  a set (a warm-up the user does not want recorded). `date` is the workout
 *  day the user is on; only that day's ticker follows the mark. */
export function reset(exerciseName: string, date: string) {
  const now = Date.now()
  setMark({ kind: "reset", atMs: now, date })
  enqueue(() => showFrom(exerciseName, now))
}

/** End the timer outside the app and hide the in-app ticker on `date`'s
 *  workout until the next saved set. */
export function stop(date: string) {
  setMark({ kind: "stop", atMs: Date.now(), date })
  enqueue(async () => {
    shown = null
    await restTimerBridge.end()
  })
}

/** Call on cold start (after hydrate) and on every return to the
 *  foreground. Ends a timer that is past its cutoff, or any timer when the
 *  feature is off, and learns about a timer an earlier process left. */
export function reconcile() {
  enqueue(async () => {
    const current = await restTimerBridge.current()
    shown = current ? { endsAt: current.endsAt } : null
    const { enabled } = settings()
    if (decideOnForeground(shown, Date.now(), enabled) === "end") {
      shown = null
      await restTimerBridge.end()
    }
  })
}

/** Call when the user turns the feature off. */
export function disable() {
  enqueue(async () => {
    shown = null
    await restTimerBridge.end()
  })
}

/** Call when the user turns the feature on, so Android asks for permission
 *  at the moment the user shows intent, not mid-set. */
export function enable() {
  enqueue(async () => {
    await notificationsAllowed()
  })
}

let askedThisProcess = false

/** Android 13+ needs POST_NOTIFICATIONS at runtime. Asks at most once per
 *  process; a refusal is the user's choice and is not asked again until the
 *  next launch. iOS asks nothing: Live Activities need no permission. */
async function notificationsAllowed(): Promise<boolean> {
  if (Platform.OS !== "android" || Platform.Version < 33) return true
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
  if (await PermissionsAndroid.check(perm)) return true
  if (askedThisProcess) return false
  askedThisProcess = true
  const res = await PermissionsAndroid.request(perm)
  return res === PermissionsAndroid.RESULTS.GRANTED
}
