import { AccountSessions, type OpenedEngine } from "@lift/engine-client/session"
import { openNativeTransport } from "../../modules/lift-engine"
import { accountDirUri, adoptLegacyStore } from "../store/storage"
import { getDeviceId, readLegacyEtag } from "../sync/deviceId"
import { createEngineOpener, withCommitHook, type OpenContext } from "./openEngine"

export type { OpenContext } from "./openEngine"

const commitListeners = new Set<() => void>()

/** Runs after every accepted command, import and replacement. */
export function onEngineCommit(listener: () => void): () => void {
  commitListeners.add(listener)
  return () => commitListeners.delete(listener)
}

function committed() {
  for (const listener of commitListeners) {
    try {
      listener()
    } catch {
      // A listener must not turn an accepted write into a failure.
    }
  }
}

const openEngine = createEngineOpener({
  adoptLegacyStore,
  accountDirUri,
  deviceId: getDeviceId,
  legacyEtag: readLegacyEtag,
  open: (sessionId, path, deviceId, now, legacy) =>
    openNativeTransport(sessionId, path, deviceId, now, legacy),
  now: () => new Date().toISOString(),
})

export async function openMobileEngine(
  accountKey: string,
  sessionId: string,
  context: OpenContext
): Promise<OpenedEngine> {
  return withCommitHook(await openEngine(accountKey, sessionId, context), committed)
}

/** The one owner of the signed-in account's data on this device. */
export const mobileSessions = new AccountSessions<OpenContext>(openMobileEngine, "mobile")
