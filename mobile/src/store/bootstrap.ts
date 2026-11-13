import { AppState } from "react-native"
import type { AccountEngineSession } from "@lift/engine-client/session"
import { mobileSessions } from "../engine/mobileEngine"
import { restTimer } from "../restTimer"
import { mobileSync } from "../sync/engineSync"
import { cancelRestorePoint, saveRestorePointNow } from "./restorePoints"

/** The engine owns the account's data: no @lift/core store loads on mobile. */

let lifecycleWired = false
// A sign-out's close must finish before a sign-in opens the next account.
let unloading: Promise<void> = Promise.resolve()

const SETTINGS_QUERY = { kind: "settings" }
const COUNTS_QUERY = { kind: "counts" }

/** Sign-out: end the rest timer and its manual reset or stop, save a restore
 *  point, then close the engine. The timer names the signed-out user's
 *  exercise, and no later set of theirs will end or replace it. */
export function unloadForSignOut(): Promise<void> {
  restTimer.disable()
  restTimer.clearMark()
  restTimer.bindEngine(null)
  mobileSync.reset()
  unloading = unloading
    .then(async () => {
      await saveRestorePointNow().catch(() => {})
      cancelRestorePoint()
      await mobileSessions.switchAccount(null)
    })
    .catch((e) => {
      console.error("Failed to close the account", e)
    })
  return unloading
}

/** Idempotent: background saves a restore point; foreground catches up on
 *  sync and on a rest timer iOS could not end while suspended. */
export function installMobileLifecycle() {
  if (lifecycleWired) return
  lifecycleWired = true
  AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      void saveRestorePointNow().catch(() => {})
    } else {
      scheduleAutoSync()
      restTimer.reconcile()
    }
  })
}

/** A newer open for another account took over before this one finished. */
export class OpenSupersededError extends Error {
  constructor() {
    super("Another account opened.")
  }
}

/**
 * Opens the signed-in user's engine, keyed by user id. A store an older build
 * kept under the username moves over first, once (openEngine.ts). Resolves
 * when the settings and counts are read, so the first frame has the right
 * weight unit and the restore prompt decision.
 */
export async function openForUser(user: { id: number; username: string }): Promise<AccountEngineSession> {
  await unloading
  installMobileLifecycle()
  const key = String(user.id)
  await mobileSessions.switchAccount(key, { username: user.username })
  const state = mobileSessions.getSnapshot()
  if (state.status === "error" && state.accountKey === key) throw state.error
  if (state.status !== "ready" || state.session.accountKey !== key) throw new OpenSupersededError()
  const { client } = state.session
  await Promise.all([
    client.prefetch("settings", SETTINGS_QUERY),
    client.prefetch("counts", COUNTS_QUERY),
  ])
  if (mobileSessions.session !== state.session) throw new OpenSupersededError()
  restTimer.bindEngine(client)
  // After the settings are read: the rest timer settings live there. On a
  // cold start this picks up a timer the previous process left running.
  restTimer.reconcile()
  scheduleAutoSync()
  return state.session
}

/**
 * Cloud sync catch-up: push if this device hasn't synced in a day. Runs on
 * open and on every foreground. A "not due" answer costs one comparison, and
 * requestIdleCallback keeps the rare push off the first frames.
 */
function scheduleAutoSync() {
  requestIdleCallback(() => {
    void mobileSync.maybeAutoSync()
  })
}
