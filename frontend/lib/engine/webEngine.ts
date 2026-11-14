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
import { BrowserStorage } from "@lift/engine-client/browser-storage"
import { nextIdAbove } from "@lift/engine-client/worker-runtime"
import { parse, SnapshotTooNewError } from "@lift/core/store/blob"
import { emptySnapshot, type Snapshot } from "@lift/core/store/schema"
import { applyPendingOps } from "@lift/core/store"
import { dedupeGyms } from "@lift/core/store/repair"
import type { BlobStorage } from "@lift/core/store/storage"
import { accountStorePath } from "@lift/core/store/paths"
import { pickWebStorage } from "@/lib/store/storage"
import { createDeviceIdSource } from "@lift/core"
import { webDeviceIdStore } from "@/lib/syncStorage"

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
  /** Whether to migrate legacy web store data into the Rust engine storage. Defaults to false. */
  migrateLegacy?: boolean
  openBrowserStorage?: (name: string) => Promise<BrowserStorage>
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

/**
 * Reads the latest snapshot from legacy storage, replaying pending mutation
 * logs and repairing gyms.
 */
export async function readLegacySnapshot(
  storage: BlobStorage,
  deviceId: string
): Promise<Snapshot | null> {
  const loaders = storage.snapshotCandidates?.() ?? [() => storage.readSnapshot()]
  let snap: Snapshot | null = null
  let foundBytes = false
  for (const load of loaders) {
    try {
      const bytes = await load()
      if (!bytes || bytes.length === 0) continue
      foundBytes = true
      const parsed = await parse(bytes)
      snap = parsed.snapshot
      break
    } catch (e) {
      if (e instanceof SnapshotTooNewError) throw e
    }
  }
  const pending = await storage.readPending()
  if (!snap) {
    if (foundBytes) {
      throw new Error("Could not decode legacy snapshot.")
    }
    if (pending.length === 0) return null
    snap = emptySnapshot(deviceId)
  }
  if (pending.length > 0) {
    snap = applyPendingOps(snap, pending)
  }
  return dedupeGyms(snap)
}

/**
 * Migrates existing legacy data to the Rust engine IndexedDB store if it has
 * not been migrated yet. Returns true if a migration was performed.
 */
export async function migrateLegacyStoreIfNeeded(
  legacy: BlobStorage,
  accountKey: string,
  deviceId: string,
  openStorage: (name: string) => Promise<BrowserStorage> = BrowserStorage.open
): Promise<boolean> {
  const hasData = await legacyStoreHasData(legacy)
  if (!hasData) return false

  const dbName = "lift-rust-engine:" + accountKey
  const storage = await openStorage(dbName)
  try {
    const existing = await storage.load()
    if (existing != null) return false
    const snapshot = await readLegacySnapshot(legacy, deviceId)
    if (!snapshot || !hasRows(snapshot)) return false
    const nextId = nextIdAbove(snapshot as unknown as Record<string, unknown>)
    await storage.replaceSnapshot(
      snapshot as unknown as Record<string, unknown>,
      1,
      1,
      nextId
    )
    return true
  } finally {
    storage.close()
  }
}

export function createWebSessions(deps: WebEngineDeps): AccountSessions {
  return new AccountSessions(
    async (accountKey: string, sessionId: string): Promise<OpenedEngine> => {
      const id = Number(accountKey)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid account id.")
      const legacy = deps.legacyStorage(accountStorePath(id))
      const hasLegacy = await legacyStoreHasData(legacy)
      if (hasLegacy) {
        if (!deps.migrateLegacy) {
          throw new WebEngineMigrationMissingError()
        }
        await migrateLegacyStoreIfNeeded(
          legacy,
          accountKey,
          await deps.getDeviceId(),
          deps.openBrowserStorage
        )
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

let activeWebSessions: AccountSessions | null = null

/** The singleton web engine session manager for the browser. */
export function getWebSessions(): AccountSessions {
  if (!activeWebSessions) {
    activeWebSessions = createWebSessions({
      createWorker: createEngineWorker,
      legacyStorage: (subPath: string) => pickWebStorage(subPath),
      getDeviceId: createDeviceIdSource(webDeviceIdStore),
      migrateLegacy: true,
    })
  }
  return activeWebSessions
}

/** Closes any active web engine worker session. */
export async function unloadWebSessions(): Promise<void> {
  if (activeWebSessions) {
    await activeWebSessions.switchAccount(null)
  }
}

/** Copy for a session that failed to open, or null when it did not fail. */
export function webEngineErrorMessage(state: SessionState): string | null {
  if (state.status !== "error") return null
  return state.error instanceof WebEngineMigrationMissingError
    ? state.error.message
    : "Your data could not be opened. Reload the page to try again."
}
