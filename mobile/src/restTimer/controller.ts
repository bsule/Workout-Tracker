// The only code that drives the rest timer outside the app. Callers fire and
// forget: nothing here blocks, throws, or slows down saving a set.

import { PermissionsAndroid, Platform } from "react-native"
import type { EngineClient } from "@lift/engine-client"
import type { UserSettings, Workout } from "@lift/core/types"
import { ymd } from "@lift/core/dates"

function dayOf(ms: number): string {
  const d = new Date(ms)
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
import { isRestTimerAvailable, restTimerBridge } from "./bridge"
import {
  decideOnForeground,
  decideOnSet,
  decideOnSetsChanged,
  restTimerSettings,
  type TimerMark,
} from "./plan"

/** The timer this process last showed. Null until the first set or the
 *  first reconcile(), which reads what the OS still has on screen. */
let shown: { endsAt: number } | null = null

/**
 * The logged set the timer counts from, by its created_at. `workout` is
 * filled in once the row is in the store: the set logger writes it a moment
 * after the tap, and until then there is nothing to lose. Null while the
 * timer counts from a reset, or when there is no timer.
 */
let anchor: {
  iso: string
  name: string
  endsAt: number
  /** The workout day the set was logged on, which the controller watches. */
  date: string
  workout: { id: number; date: string } | null
} | null = null

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
    follow(null)
  })
}

// The engine session of the signed-in account. The controller reads the
// rest timer settings from it and watches the workout its set belongs to.
let client: EngineClient | null = null
let stopSettings: (() => void) | null = null
const SETTINGS_QUERY = { kind: "settings" }

/** Call when an account's engine opens (with its client) and on sign-out
 *  (with null). Keeps the settings live so a save reads them at once. */
export function bindEngine(next: EngineClient | null) {
  if (next === client) return
  stopSettings?.()
  stopSettings = null
  unwatch()
  client = next
  if (next) stopSettings = next.subscribe("settings", SETTINGS_QUERY, () => {})
  if (anchor) watch(anchor.date)
}

function settings() {
  const state = client?.snapshot<UserSettings>("settings", SETTINGS_QUERY)
  return restTimerSettings(state?.status === "ready" ? state.value : {})
}

/** Call when a set is saved (not edited). `atMs` must match the time the
 *  in-app ticker counts from, so the two agree to the second. `date` is the
 *  workout day the set goes on (today when omitted). */
export function setLogged(exerciseName: string, atMs: number, date?: string) {
  const { enabled, cutoffS } = settings()
  follow(
    enabled && isRestTimerAvailable()
      ? {
          iso: new Date(atMs).toISOString(),
          name: exerciseName,
          endsAt: atMs + cutoffS * 1000,
          date: date ?? dayOf(atMs),
          workout: null,
        }
      : null
  )
  enqueue(() => showFrom(exerciseName, atMs))
}

// The workout_by_date query of the anchor's day, while there is an anchor.
let watched: { date: string; stop: () => void } | null = null

function workoutQuery(date: string) {
  return { key: `workout_by_date:${date}`, query: { kind: "workout_by_date", date } }
}

function watch(date: string) {
  if (watched?.date === date || !client) return
  unwatch()
  const { key, query } = workoutQuery(date)
  watched = { date, stop: client.subscribe(key, query, onWorkoutChange) }
}

function unwatch() {
  watched?.stop()
  watched = null
}

function follow(next: typeof anchor) {
  anchor = next
  if (next) watch(next.date)
  else unwatch()
}

function readWorkout(date: string): Workout | null | undefined {
  if (!client) return undefined
  const { key, query } = workoutQuery(date)
  const state = client.snapshot<Workout | null>(key, query)
  return state.status === "ready" ? state.value : undefined
}

/**
 * A set leaves the workout without a call here: a swipe delete, removing the
 * exercise, deleting the workout, a restore. When the one the timer counts
 * from goes, follow the in-app ticker (decideOnSetsChanged) instead of
 * counting on from a set that is gone.
 */
function onWorkoutChange() {
  const a = anchor
  if (!a) return
  if (Date.now() >= a.endsAt) {
    follow(null)
    return
  }
  const workout = readWorkout(a.date)
  if (workout === undefined) return
  if (!a.workout) {
    // Until the logger's row lands there is nothing to lose.
    const found = workout?.exercises.some((we) =>
      we.sets.some((s) => !s.is_planned && s.created_at === a.iso)
    )
    if (found && workout) a.workout = { id: workout.id, date: workout.date }
    return
  }
  const workoutSets: { is_planned?: boolean; created_at: string; exerciseName: string }[] = []
  if (workout && workout.id === a.workout.id) {
    for (const we of workout.exercises) {
      const exerciseName = we.exercise?.name ?? a.name
      for (const s of we.sets) {
        workoutSets.push({ is_planned: s.is_planned, created_at: s.created_at, exerciseName })
      }
    }
  }
  const { enabled, cutoffS } = settings()
  const action = decideOnSetsChanged({
    anchorIso: a.iso,
    workoutSets,
    date: a.workout.date,
    mark,
    shownName: a.name,
    now: Date.now(),
    cutoffS,
  })
  if (action.kind === "none") return
  if (action.kind === "end" || !enabled) {
    follow(null)
    enqueue(async () => {
      if (!shown) return
      shown = null
      await restTimerBridge.end()
    })
    return
  }
  const input = {
    exerciseName: action.exerciseName,
    startedAt: action.startedAt,
    endsAt: action.startedAt + cutoffS * 1000,
  }
  follow(
    action.setIso
      ? { iso: action.setIso, name: input.exerciseName, endsAt: input.endsAt, date: a.date, workout: a.workout }
      : null
  )
  enqueue(async () => {
    // Only move a timer that is up. One that ended is not brought back.
    if (!shown) return
    await restTimerBridge.update(input)
    shown = { endsAt: input.endsAt }
  })
}

async function showFrom(exerciseName: string, atMs: number) {
  const { enabled, cutoffS } = settings()
  const action = decideOnSet(shown, Date.now(), enabled)
  if (action === "none") return
  if (action === "end") {
    shown = null
    follow(null)
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
  follow(null)
  setMark({ kind: "reset", atMs: now, date })
  enqueue(() => showFrom(exerciseName, now))
}

/** End the timer outside the app and hide the in-app ticker on `date`'s
 *  workout until the next saved set. */
export function stop(date: string) {
  follow(null)
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
      follow(null)
      await restTimerBridge.end()
      return
    }
    // A timer an earlier process left: follow its set if one matches. One
    // that counts from a reset matches no set and is left alone.
    if (current && !anchor) {
      follow({
        iso: new Date(current.startedAt).toISOString(),
        name: current.exerciseName,
        endsAt: current.endsAt,
        date: dayOf(current.startedAt),
        workout: null,
      })
    }
  })
}

/** Call when the user turns the feature off. */
export function disable() {
  follow(null)
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
