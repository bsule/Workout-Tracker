import { AppState, InteractionManager } from "react-native"
import {
  setStorageFactory,
  configureStore,
  hydrateStore,
  flushOnHide,
  addFlushListener,
  autoSync,
} from "@lift/core"
import { RnFsStorage } from "./storage"
import {
  configureBackupRunner,
  runBackup,
  scheduleDebouncedBackup,
} from "../backup/runner"

let installed = false
let lifecycleWired = false
let currentUserKey = "anon"

/**
 * Idempotent install: registers the FS-backed storage adapter and wires the
 * RN AppState lifecycle (background/inactive → flushOnHide). Safe to call
 * before login; per-user `configure()` happens in bootstrapForUser().
 */
export function installMobileStore() {
  if (installed) return
  installed = true
  setStorageFactory((sub) => new RnFsStorage(sub))
  configureBackupRunner({ getUsername: () => currentUserKey })
  // Every successful flush of the in-memory snapshot triggers a debounced
  // backup write to the user's Files folder (no-op if no folder configured).
  addFlushListener(() => scheduleDebouncedBackup())
  if (!lifecycleWired) {
    lifecycleWired = true
    AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        flushOnHide()
      } else {
        // Foregrounding: best-effort backup confirms the latest snapshot
        // is mirrored to the user's Files folder.
        void runBackup("open")
        scheduleAutoSync()
      }
    })
  }
}

/**
 * Hydrates the store for a specific user (or "anon" before login). Reuses the
 * web's path scheme `users/<key>` so a single device snapshot is portable
 * via export/import or future R2 sync.
 */
export async function bootstrapForUser(userKey: string) {
  installMobileStore()
  currentUserKey = userKey
  configureStore(`users/${userKey}`)
  await hydrateStore()
  // Best-effort initial backup after hydration. The runner short-circuits if
  // the user hasn't picked a folder yet, and the restore flow handles the
  // empty-store case before this fires (RootNavigator gating).
  void runBackup("open")
  scheduleAutoSync()
}

/**
 * Cloud sync catch-up: push if this device hasn't synced in 3 days.
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
