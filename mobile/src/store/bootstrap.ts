import { AppState } from "react-native"
import {
  setStorageFactory,
  configureStore,
  hydrateStore,
  flushOnHide,
} from "@lift/core"
import { RnFsStorage } from "./storage"

let installed = false
let lifecycleWired = false

/**
 * Idempotent install: registers the FS-backed storage adapter and wires the
 * RN AppState lifecycle (background/inactive → flushOnHide). Safe to call
 * before login; per-user `configure()` happens in bootstrapForUser().
 */
export function installMobileStore() {
  if (installed) return
  installed = true
  setStorageFactory((sub) => new RnFsStorage(sub))
  if (!lifecycleWired) {
    lifecycleWired = true
    AppState.addEventListener("change", (state) => {
      if (state !== "active") flushOnHide()
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
  configureStore(`users/${userKey}`)
  await hydrateStore()
}
