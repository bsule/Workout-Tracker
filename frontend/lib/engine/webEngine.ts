/**
 * Browser adapter for the Rust engine (a dedicated worker running Wasm over
 * IndexedDB). NOT USED by the web app: the web keeps the @lift/core store as
 * its only data owner until browser legacy migration exists. Nothing may call
 * createWebSessions() unless WEB_ENGINE_ENABLED is true.
 *
 * Hosts that do enable it must:
 * - open sessions only while holding the `lift:store-editor` Web Lock
 *   (frontend/components/store/StoreOwner.tsx) and close them before release;
 * - render SessionState `error` (webEngineErrorMessage) instead of waiting on
 *   a loader, because a failed open never turns into `ready`.
 */

import { AccountSessions, type OpenedEngine, type SessionState } from "@lift/engine-client/session"
import { openWorkerTransport } from "@lift/engine-client/worker-transport"
import { parse } from "@lift/core/store/blob"
import { emptySnapshot, type Snapshot } from "@lift/core/store/schema"
import type { BlobStorage } from "@lift/core/store/storage"
import { accountStorePath } from "@lift/core/store/paths"

/** Off unless a build sets NEXT_PUBLIC_LIFT_WEB_ENGINE=1. */
export const WEB_ENGINE_ENABLED = process.env.NEXT_PUBLIC_LIFT_WEB_ENGINE === "1"

export const WEB_ENGINE_MIGRATION_MISSING =
  "This browser has data saved by the current web store. Moving it to the new engine is not implemented yet, so the engine was not opened and nothing was changed."

export class WebEngineMigrationMissingError extends Error {
  constructor() {
    super(WEB_ENGINE_MIGRATION_MISSING)
    this.name = "WebEngineMigrationMissingError"
  }
}

export interface WebEngineDeps {
  /** A new worker for each session. A closed or failed one is terminated. */
  createWorker(): Worker
  /** The legacy @lift/core store for an account path (OPFS or IndexedDB). */
  legacyStorage(subPath: string): BlobStorage
  getDeviceId(): Promise<string>
  now?(): string
}

const TABLES = ["exercises", "workouts", "workout_exercises", "sets", "gyms", "day_notes"] as const

function hasRows(snapshot: Snapshot): boolean {
  return TABLES.some((table) => snapshot[table].length > 0)
}

/**
 * Whether the legacy store for this account holds anything. Read errors and
 * undecodable copies reject: an unreadable store is never treated as empty,
 * or the engine would start a fresh account on top of real data.
 */
export async function legacyStoreHasData(storage: BlobStorage): Promise<boolean> {
  const pending = await storage.readPending()
  if (pending.some((line) => line.trim())) return true
  const loaders = storage.snapshotCandidates?.() ?? [() => storage.readSnapshot()]
  for (const load of loaders) {
    const bytes = await load()
    if (!bytes || bytes.length === 0) continue
    const { snapshot } = await parse(bytes)
    if (hasRows(snapshot)) return true
  }
  return false
}

export function createWebSessions(deps: WebEngineDeps): AccountSessions {
  return new AccountSessions(
    async (accountKey: string, sessionId: string): Promise<OpenedEngine> => {
      const id = Number(accountKey)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid account id.")
      if (await legacyStoreHasData(deps.legacyStorage(accountStorePath(id)))) {
        throw new WebEngineMigrationMissingError()
      }
      const initial = emptySnapshot(await deps.getDeviceId())
      if (deps.now) initial.exported_at = deps.now()
      const { transport, generation, revision } = await openWorkerTransport(
        deps.createWorker(),
        sessionId,
        accountKey,
        initial
      )
      return { transport, generation, revision }
    },
    "web"
  )
}

/** The production worker, built by scripts/engine/web-worker-build.mjs. */
export function createEngineWorker(): Worker {
  return new Worker(new URL("/wasm/engine-worker.js", window.location.origin), { type: "module" })
}

/** Copy for a session that failed to open, or null when it did not fail. */
export function webEngineErrorMessage(state: SessionState): string | null {
  if (state.status !== "error") return null
  return state.error instanceof WebEngineMigrationMissingError
    ? state.error.message
    : "Your data could not be opened. Reload the page to try again."
}
