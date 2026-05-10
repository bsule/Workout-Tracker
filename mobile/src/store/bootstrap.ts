import { AppState } from "react-native"
import {
  setStorageFactory,
  configureStore,
  hydrateStore,
  flushOnHide,
  addFlushListener,
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
}
