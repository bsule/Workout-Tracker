/**
 * Cloud sync for the signed-in account, through its engine. The engine keeps
 * the ETag and decides which pushes it may adopt; this module binds it to the
 * account's credentials and the device-local sync clock (last synced, and the
 * "cloud is newer" prompt state).
 */
import Constants from "expo-constants"
import { EngineSync } from "@lift/engine-client/sync-client"
import { SnapshotHttp } from "@lift/engine-client/snapshot-http"
import { EngineSyncService, type SyncConnection } from "@lift/engine-client/auto-sync"
import type { AccountEngineSession } from "@lift/engine-client/session"
import {
  getSyncClock,
  hasCloudConflict,
  loadSyncClock,
  markCloudNewer,
  markSynced,
} from "@lift/core/sync/syncClock"
import { parse } from "@lift/core/store/blob"
import { mobileSessions } from "../engine/mobileEngine"

export { SyncQuotaError, SyncConflict, type SyncQuota } from "@lift/engine-client/snapshot-http"
export type { CloudPreview } from "@lift/engine-client/auto-sync"

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:8787/api"

let token: string | null = null
let bound: { session: AccountEngineSession; token: string; sync: EngineSync } | null = null

function unbind() {
  bound?.sync.close()
  bound = null
}

/** Signed in: the account token. Signed out: null, which turns sync off and
 *  aborts any request still in flight. */
export function configureEngineSync(next: string | null) {
  if (next === token) return
  token = next
  unbind()
}

// Closing or switching the account aborts its requests, so a late reply can
// never write into the next account.
mobileSessions.subscribe(() => {
  if (bound && mobileSessions.session !== bound.session) unbind()
})

function connection(): SyncConnection | null {
  const session = mobileSessions.session
  const data = session?.data
  if (!session || !data || !token) return null
  if (!bound || bound.session !== session || bound.token !== token) {
    unbind()
    bound = { session, token, sync: new EngineSync(data, new SnapshotHttp(API_BASE, token)) }
  }
  return {
    sync: bound.sync,
    version: () => data.currentVersion(),
    workoutCount: async () => (await session.api.counts()).workouts,
  }
}

export const mobileSync = new EngineSyncService({
  connection,
  clock: {
    load: loadSyncClock,
    lastSyncedAt: () => getSyncClock().lastSyncedAt,
    hasConflict: hasCloudConflict,
    markSynced,
    markCloudNewer,
  },
  async describe(bytes) {
    const { snapshot } = await parse(bytes)
    return {
      exportedAt: snapshot.exported_at ?? null,
      workoutCount: snapshot.workouts.length,
      setCount: snapshot.sets.length,
      customExerciseCount: snapshot.exercises.filter((e) => e.is_custom).length,
      gymCount: snapshot.gyms.length,
    }
  },
})
