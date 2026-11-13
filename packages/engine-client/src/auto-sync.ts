/**
 * Cloud sync on the engine: the same rules as @lift/core's autoSync, with the
 * ETag kept by the engine instead of a JS transport.
 *
 * - "Sync now" pushes. A 412 records the cloud version that won (the host's
 *   sync clock) and returns { kind: "stale" } so the UI asks: pull or
 *   overwrite. A 429 throws SyncQuotaError.
 * - Previewing the cloud copy never adopts its ETag; applying it does.
 * - maybeAutoSync() pushes when this device never synced or the last sync is
 *   at least 20 hours old, retries no sooner than 15 minutes after a failed
 *   attempt, and skips when sync is not configured, another automatic sync is
 *   in flight, the store is not ready, there are no workouts, or a conflict is
 *   open. An automatic push must never overwrite the cloud copy with nothing.
 *
 * Every path that leaves local and cloud in agreement calls markSynced().
 */
import { SyncConflict, SyncQuotaError, type RemoteSnapshot, type SyncQuota } from './snapshot-http'
import type { EngineSync } from './sync-client'

export const AUTO_SYNC_PERIOD_MS = 20 * 60 * 60 * 1000
export const AUTO_SYNC_RETRY_MS = 15 * 60 * 1000

/** The live account: its sync channel and the reads auto sync needs. */
export interface SyncConnection {
  sync: EngineSync
  /** Committed version once queued writes landed (for a replacement). */
  version(): Promise<{ generation: number; revision: number }>
  workoutCount(): Promise<number>
}

/** The device-local clock (lastSyncedAt and the conflict prompt state). */
export interface SyncClockPort {
  load(): Promise<unknown>
  lastSyncedAt(): number | null
  hasConflict(): boolean
  markSynced(at?: number): void
  markCloudNewer(etag: string | null): void
}

export interface PreviewCounts {
  exportedAt: string | null
  workoutCount: number
  setCount: number
  customExerciseCount: number
  gymCount: number
}
export type CloudPreview = PreviewCounts & { bytes: Uint8Array; etag: string }

export type SyncOutcome =
  | { kind: 'pushed'; quota: SyncQuota | null }
  | { kind: 'stale'; remoteEtag: string | null }

export type AutoSyncSkip =
  | 'in-flight'
  | 'not-configured'
  | 'not-hydrated'
  | 'empty'
  | 'not-due'
  | 'cooling-down'
  | 'cloud-newer'

export type AutoSyncResult =
  | { kind: 'skipped'; reason: AutoSyncSkip }
  | { kind: 'synced' }
  | { kind: 'stale' }
  | { kind: 'failed'; error: unknown }

export interface EngineSyncServiceOptions {
  /** Null when signed out or the engine is not open. */
  connection(): SyncConnection | null
  clock: SyncClockPort
  /** Reads a downloaded snapshot for the preview counts. */
  describe(bytes: Uint8Array): Promise<PreviewCounts>
}

export class EngineSyncService {
  private autoInFlight = false
  private lastAutoAttemptAt = 0
  private lastQuota: SyncQuota | null = null
  constructor(private options: EngineSyncServiceOptions) {}

  isConfigured(): boolean {
    return this.options.connection() !== null
  }

  private require(): SyncConnection {
    const connection = this.options.connection()
    if (!connection) throw new Error('sync transport not configured (not signed in?)')
    return connection
  }

  private remember<T extends { quota: SyncQuota | null }>(result: T): T {
    if (result.quota) this.lastQuota = result.quota
    return result
  }

  async syncNow(): Promise<SyncOutcome> {
    const { sync } = this.require()
    try {
      const { quota } = this.remember(await sync.push())
      this.options.clock.markSynced()
      return { kind: 'pushed', quota }
    } catch (error) {
      if (error instanceof SyncConflict) {
        // Nothing was overwritten. Record which cloud version won so the
        // host tells the user once.
        this.options.clock.markCloudNewer(error.remoteEtag)
        return { kind: 'stale', remoteEtag: error.remoteEtag }
      }
      if (error instanceof SyncQuotaError && error.quota) this.lastQuota = error.quota
      throw error
    }
  }

  /** Overwrite the cloud copy with this device's data, whatever is there. */
  async forcePush(): Promise<void> {
    const { sync } = this.require()
    // Read the cloud's current version so the server accepts the push.
    const remote = await sync.preview()
    try {
      this.remember(await sync.push(remote?.etag ?? null))
    } catch (error) {
      if (error instanceof SyncQuotaError && error.quota) this.lastQuota = error.quota
      throw error
    }
    this.options.clock.markSynced()
  }

  /** The cloud copy with its counts. Only looking never adopts its ETag. */
  async previewRemote(): Promise<CloudPreview | null> {
    const { sync } = this.require()
    const remote = await sync.preview()
    if (!remote) return null
    return { ...(await this.options.describe(remote.bytes)), bytes: remote.bytes, etag: remote.etag }
  }

  /** Replace local data with a previewed cloud copy and adopt its version. */
  async applyRemote(remote: RemoteSnapshot): Promise<void> {
    const connection = this.require()
    const { generation, revision } = await connection.version()
    await connection.sync.applyRemote(remote, generation, revision)
    this.options.clock.markSynced()
  }

  /** Pull and replace. True if the cloud had a copy. */
  async pullAndReplace(): Promise<boolean> {
    const remote = await this.require().sync.preview()
    if (!remote) return false
    await this.applyRemote(remote)
    return true
  }

  async fetchQuota(): Promise<SyncQuota | null> {
    const connection = this.options.connection()
    if (!connection) return null
    this.lastQuota = await connection.sync.quota()
    return this.lastQuota
  }

  getCachedQuota(): SyncQuota | null {
    return this.lastQuota
  }

  /** Never throws. Cheap to call on every app open and foreground. */
  async maybeAutoSync(now: number = Date.now()): Promise<AutoSyncResult> {
    if (this.autoInFlight) return skipped('in-flight')
    const connection = this.options.connection()
    if (!connection) return skipped('not-configured')
    this.autoInFlight = true
    try {
      let workouts: number
      try {
        workouts = await connection.workoutCount()
      } catch {
        // The engine is closing or not open: same as unhydrated.
        return skipped('not-hydrated')
      }
      if (this.options.connection() !== connection) return skipped('not-hydrated')
      if (workouts === 0) return skipped('empty')
      await this.options.clock.load()
      if (this.options.clock.hasConflict()) return skipped('cloud-newer')
      const last = this.options.clock.lastSyncedAt()
      if (last !== null && now - last < AUTO_SYNC_PERIOD_MS) return skipped('not-due')
      if (this.lastAutoAttemptAt > 0 && now - this.lastAutoAttemptAt < AUTO_SYNC_RETRY_MS) {
        return skipped('cooling-down')
      }
      this.lastAutoAttemptAt = now
      try {
        const outcome = await this.syncNow()
        return outcome.kind === 'pushed' ? { kind: 'synced' } : { kind: 'stale' }
      } catch (error) {
        return { kind: 'failed', error }
      }
    } finally {
      this.autoInFlight = false
    }
  }

  /** Test seam and sign-out: forget the in-process cooldown and quota. */
  reset(): void {
    this.autoInFlight = false
    this.lastAutoAttemptAt = 0
    this.lastQuota = null
  }
}

function skipped(reason: AutoSyncSkip): AutoSyncResult {
  return { kind: 'skipped', reason }
}
