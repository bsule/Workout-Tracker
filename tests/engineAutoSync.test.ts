/**
 * Cloud sync on the engine (packages/engine-client/src/auto-sync.ts): the
 * same rules as @lift/core's autoSync, with the ETag held by the engine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  AUTO_SYNC_PERIOD_MS,
  AUTO_SYNC_RETRY_MS,
  EngineSyncService,
  type SyncConnection,
} from "../packages/engine-client/src/auto-sync"
import { SnapshotHttp, SyncQuotaError } from "../packages/engine-client/src/snapshot-http"
import { EngineSync, type SyncEngine } from "../packages/engine-client/src/sync-client"

const T0 = Date.UTC(2026, 8, 21, 12)
const quota = { used: 1, limit: 5, remaining: 4, resets_at: "2026-09-22T00:00:00Z" }

function harness(responses: Array<() => Response>) {
  const calls: { method: string; url: string; ifMatch: string | null; ifNoneMatch: string | null }[] = []
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    calls.push({ method: init.method ?? "GET", url, ifMatch: headers.get("If-Match"), ifNoneMatch: headers.get("If-None-Match") })
    const next = responses.shift()
    if (!next) throw new Error("offline")
    return next()
  })
  const engine: SyncEngine & { etag: string | null } = {
    etag: "local",
    prepareUpload: vi.fn(async () => ({ bytes: new Uint8Array([1]), generation: 1, revision: 5, etag: engine.etag, deviceId: "install" })),
    acknowledgePush: vi.fn(async (_g, _r, _e, etag) => { engine.etag = etag }),
    replaceSnapshot: vi.fn(async (_b, _g, _r, etag) => { engine.etag = etag }),
  }
  const sync = new EngineSync(engine, new SnapshotHttp("https://x.test/api", "token", request as unknown as typeof fetch), () => "now")
  const clock = {
    last: null as number | null,
    conflict: null as string | null,
    load: vi.fn(async () => {}),
    lastSyncedAt: () => clock.last,
    hasConflict: () => clock.conflict !== null,
    markSynced: vi.fn((at?: number) => { clock.last = at ?? Date.now(); clock.conflict = null }),
    markCloudNewer: vi.fn((etag: string | null) => { clock.conflict = etag ?? "" }),
  }
  let workouts = 3
  let connected = true
  const connection: SyncConnection = {
    sync,
    version: async () => ({ generation: 1, revision: 5 }),
    workoutCount: async () => workouts,
  }
  const service = new EngineSyncService({
    connection: () => (connected ? connection : null),
    clock,
    describe: async () => ({ exportedAt: "2026-09-20T00:00:00Z", workoutCount: 9, setCount: 90, customExerciseCount: 1, gymCount: 1 }),
  })
  return {
    service, engine, clock, calls,
    setWorkouts: (n: number) => { workouts = n },
    disconnect: () => { connected = false },
  }
}

const ok = () => new Response(JSON.stringify({ etag: "pushed", quota }))
const stale = () => new Response(JSON.stringify({ etag: "cloud" }), { status: 412 })
const remote = () => new Response(new Uint8Array([7]), { headers: { etag: '"cloud"' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
})

describe("Sync now", () => {
  it("pushes with the engine's etag and marks the clock", async () => {
    const h = harness([ok])
    expect(await h.service.syncNow()).toEqual({ kind: "pushed", quota })
    expect(h.calls[0].ifMatch).toBe('"local"')
    expect(h.engine.etag).toBe("pushed")
    expect(h.clock.markSynced).toHaveBeenCalled()
    expect(h.service.getCachedQuota()).toEqual(quota)
  })

  it("records a refused push once and returns stale, adopting nothing", async () => {
    const h = harness([stale])
    expect(await h.service.syncNow()).toEqual({ kind: "stale", remoteEtag: "cloud" })
    expect(h.clock.markCloudNewer).toHaveBeenCalledWith("cloud")
    expect(h.engine.etag).toBe("local")
  })

  it("throws the quota error with the server's numbers", async () => {
    const h = harness([() => new Response(JSON.stringify({ quota: { ...quota, remaining: 0 } }), { status: 429 })])
    const error = await h.service.syncNow().catch((e) => e)
    expect(error).toBeInstanceOf(SyncQuotaError)
    expect(error.message).toBe("Daily sync limit reached (5/day). Resets at 2026-09-22T00:00:00Z.")
    expect(h.service.getCachedQuota()?.remaining).toBe(0)
  })
})

describe("cloud copy", () => {
  it("previewing does not adopt the cloud's etag; applying does", async () => {
    const h = harness([remote])
    const preview = await h.service.previewRemote()
    expect(preview).toMatchObject({ workoutCount: 9, etag: "cloud" })
    expect(h.engine.etag).toBe("local")
    await h.service.applyRemote(preview!)
    expect(h.engine.replaceSnapshot).toHaveBeenCalledWith(preview!.bytes, 1, 5, "cloud", "now")
    expect(h.clock.markSynced).toHaveBeenCalled()
  })

  it("force push overwrites with the cloud's current etag", async () => {
    const h = harness([remote, ok])
    await h.service.forcePush()
    expect(h.calls[1]).toMatchObject({ method: "PUT", ifMatch: '"cloud"' })
    // Adoption still checks the etag the upload was captured with.
    expect(h.engine.acknowledgePush).toHaveBeenCalledWith(1, 5, "local", "pushed", "now")
  })

  it("force push to an empty cloud uses If-None-Match", async () => {
    const h = harness([() => new Response(null, { status: 204 }), ok])
    await h.service.forcePush()
    expect(h.calls[1].ifNoneMatch).toBe("*")
  })

  it("pull with nothing in the cloud replaces nothing", async () => {
    const h = harness([() => new Response(null, { status: 204 })])
    expect(await h.service.pullAndReplace()).toBe(false)
    expect(h.engine.replaceSnapshot).not.toHaveBeenCalled()
  })
})

describe("maybeAutoSync", () => {
  it("pushes when this device never synced", async () => {
    const h = harness([ok])
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "synced" })
  })

  it("skips when signed out, empty, not due, or a conflict is open", async () => {
    const h = harness([])
    h.setWorkouts(0)
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "skipped", reason: "empty" })
    h.setWorkouts(1)
    h.clock.last = T0 - AUTO_SYNC_PERIOD_MS + 1
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "skipped", reason: "not-due" })
    h.clock.conflict = "cloud"
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "skipped", reason: "cloud-newer" })
    h.disconnect()
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "skipped", reason: "not-configured" })
    expect(h.calls).toEqual([])
  })

  it("is due again after 20 hours", async () => {
    const h = harness([ok])
    h.clock.last = T0 - AUTO_SYNC_PERIOD_MS
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "synced" })
  })

  it("stays off the network for 15 minutes after a failure", async () => {
    const h = harness([])
    expect((await h.service.maybeAutoSync(T0)).kind).toBe("failed")
    expect(await h.service.maybeAutoSync(T0 + AUTO_SYNC_RETRY_MS - 1)).toEqual({ kind: "skipped", reason: "cooling-down" })
    expect(h.calls).toHaveLength(1)
  })

  it("reports a 412 as stale and records the conflict", async () => {
    const h = harness([stale])
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "stale" })
    expect(h.clock.conflict).toBe("cloud")
  })

  it("runs one automatic sync at a time", async () => {
    const h = harness([ok])
    const first = h.service.maybeAutoSync(T0)
    expect(await h.service.maybeAutoSync(T0)).toEqual({ kind: "skipped", reason: "in-flight" })
    await first
  })
})
