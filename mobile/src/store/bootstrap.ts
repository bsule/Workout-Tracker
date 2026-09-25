import { AppState, InteractionManager } from "react-native"
import {
  setStorageFactory,
  configureStore,
  hydrateStore,
  flushOnHide,
  autoSync,
  unloadStore,
} from "@lift/core"
import { accountStorePath, legacyStorePath } from "@lift/core/store/paths"
import { adoptLegacyStore, createActiveStorage } from "./storage"
import { restTimer } from "../restTimer"

let installed = false
let lifecycleWired = false
// A sign-out's save must finish before a sign-in configures the next store.
let unloading: Promise<void> = Promise.resolve()

/** Sign-out: end the rest timer, save the store, then drop it from memory.
 *  The timer names the signed-out user's exercise, and no later set of theirs
 *  will end or replace it. A manual reset or stop goes with it. */
export function unloadForSignOut(): Promise<void> {
  restTimer.disable()
  restTimer.clearMark()
  unloading = unloading.then(unloadStore).catch((e) => {
    console.error("Failed to unload the store", e)
  })
  return unloading
}

/**
 * Idempotent install: registers the FS-backed storage adapter and wires the
 * RN AppState lifecycle (background/inactive → flushOnHide). Safe to call
 * before login; per-user `configure()` happens in bootstrapForUser().
 */
export function installMobileStore() {
  if (installed) return
  installed = true
  setStorageFactory(createActiveStorage)
  if (!lifecycleWired) {
    lifecycleWired = true
    AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        flushOnHide()
      } else {
        scheduleAutoSync()
        // iOS cannot end the rest timer while the app is suspended, so one
        // past its cutoff can still be on the Lock Screen.
        restTimer.reconcile()
      }
    })
  }
}

/**
 * Hydrates the store for a signed-in user, keyed by user id (the web uses the
 * same path scheme, accountStorePath). A store an older build kept under the
 * username moves over first, once.
 */
export async function bootstrapForUser(user: { id: number; username: string }) {
  await unloading
  installMobileStore()
  const subPath = accountStorePath(user.id)
  if (user.username) await adoptLegacyStore(legacyStorePath(user.username), subPath)
  configureStore(subPath)
  await hydrateStore()
  scheduleAutoSync()
  // After hydrate, because the rest timer settings live in the snapshot. On
  // a cold start this picks up a timer the previous process left running.
  restTimer.reconcile()
}

/**
 * Cloud sync catch-up: push if this device hasn't synced in a day.
 *
 * Runs on cold start and on every foreground, which is often — that is fine.
 * After the first call the clock is in memory, so a "not due" answer is one
 * comparison: no disk, no network, no render. serialize() (JSON.stringify +
 * gzipSync) only runs on the rare due call, and runAfterInteractions keeps it
 * off the first frames. Signed out, offline, or unhydrated it does nothing —
 * see autoSync.maybeAutoSync().
 */
function scheduleAutoSync() {
  InteractionManager.runAfterInteractions(() => {
    void autoSync.maybeAutoSync()
  })
}
