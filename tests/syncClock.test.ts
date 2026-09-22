/**
 * The "last synced" clock and the daily auto-sync check.
 *
 * The clock is device-local state held in @lift/core/sync/syncClock, written
 * by every sync path that leaves local and cloud in agreement. The check in
 * autoSync.maybeAutoSync() reads it and decides whether to push.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  autoSync,
  clearSyncClock,
  configureSyncClock,
  CloudflareTransport,
  formatLastSynced,
  getLastSyncedAt,
  getSyncClock,
  hasCloudConflict,
  loadSyncClock,
  markCloudNewer,
  markCloudNewerPrompted,
  markSynced,
  requestCloudNewerPrompt,
  shouldPromptCloudNewer,
  subscribeSyncClock,
  sync as syncModule,
  type SyncClockStore,
} from "@lift/core"
import { blankSnapshot, exercise, we, set, workout } from "./helpers/build"
import { installMemoryStorage, loadSnapshot, resetStore } from "./helpers/store"

const DAY = 86_400_000
const realFetch = globalThis.fetch

function memoryClock(initial: string | null = null) {
  let value = initial
  const store: SyncClockStore & { value: () => string | null } = {
    async get() {
      return value
    },
    async set(next: string) {
      value = next
    },
    async clear() {
      value = null
    },
    value: () => value,
  }
  return store
}

/** A snapshot with one logged set — maybeAutoSync refuses to push an empty one. */
function snapshotWithData() {
  const snap = blankSnapshot()
  snap.exercises = [exercise(1, "Bench Press")]
  snap.workouts = [workout(1, "2026-09-01")]
  snap.workout_exercises = [we(1, 1, 1)]
  snap.sets = [set(1, 1, { weight: 100, reps: 5 })]
  return snap
}

function mockFetch(handler: () => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async () => handler()) as typeof fetch
}

const QUOTA = { used: 1, limit: 5, remaining: 4, resets_at: "2026-01-02T00:00:00Z" }

function stalePush(etag: string | null) {
  return new Response(
    JSON.stringify({ detail: "Snapshot has changed remotely", etag, quota: QUOTA }),
    { status: 412, headers: { "Content-Type": "application/json" } }
  )
}

function okPush() {
  return new Response(JSON.stringify({ etag: "etag-1", quota: QUOTA }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function configureTransport() {
  syncModule.configureSync(
    new CloudflareTransport({
      apiBase: "http://localhost:8787/api",
      getToken: () => "secret-token",
    })
  )
}

beforeEach(() => {
  installMemoryStorage()
  resetStore()
  configureSyncClock(null)
  syncModule.configureSync(null)
  autoSync._resetAutoSyncState()
})

afterEach(() => {
  globalThis.fetch = realFetch
  configureSyncClock(null)
  syncModule.configureSync(null)
})

describe("syncClock", () => {
  it("reads null when the device has never synced", async () => {
    configureSyncClock(memoryClock())
    expect((await loadSyncClock()).lastSyncedAt).toBeNull()
    expect(getLastSyncedAt()).toBeNull()
  })

  it("loads a stored record and then answers from memory", async () => {
    const store = memoryClock(
      JSON.stringify({ lastSyncedAt: 1700000000000 })
    )
    const spy = vi.spyOn(store, "get")
    configureSyncClock(store)
    expect((await loadSyncClock()).lastSyncedAt).toBe(1700000000000)
    expect((await loadSyncClock()).lastSyncedAt).toBe(1700000000000)
    // Cheap to call on every app open: storage is read once per session.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("reads the bare timestamp written before the conflict fields existed", async () => {
    configureSyncClock(memoryClock("1700000000000"))
    const clock = await loadSyncClock()
    expect(clock.lastSyncedAt).toBe(1700000000000)
    expect(clock.cloudNewerAt).toBeNull()
  })

  it("treats unparseable storage as never synced", async () => {
    configureSyncClock(memoryClock("not-a-number"))
    expect((await loadSyncClock()).lastSyncedAt).toBeNull()
  })

  it("survives a storage that throws", async () => {
    configureSyncClock({
      async get() {
        throw new Error("private mode")
      },
      async set() {
        throw new Error("private mode")
      },
      async clear() {
        throw new Error("private mode")
      },
    })
    expect((await loadSyncClock()).lastSyncedAt).toBeNull()
    expect(() => markSynced(1234)).not.toThrow()
    expect(getLastSyncedAt()).toBe(1234)
  })

  it("markSynced writes through and notifies subscribers", async () => {
    const store = memoryClock()
    configureSyncClock(store)
    const seen: (number | null)[] = []
    const off = subscribeSyncClock(() => seen.push(getLastSyncedAt()))
    markSynced(1700000000000)
    off()
    expect(getLastSyncedAt()).toBe(1700000000000)
    expect(JSON.parse(store.value() ?? "null")).toMatchObject({
      lastSyncedAt: 1700000000000,
    })
    expect(seen).toEqual([1700000000000])
  })

  it("clearSyncClock forgets the value on logout", async () => {
    const store = memoryClock(JSON.stringify({ lastSyncedAt: 1700000000000 }))
    configureSyncClock(store)
    await loadSyncClock()
    clearSyncClock()
    expect(getLastSyncedAt()).toBeNull()
    expect(store.value()).toBeNull()
  })
})

describe("formatLastSynced", () => {
  const now = 1_700_000_000_000
  it("covers every bucket", () => {
    expect(formatLastSynced(null, now)).toBe("Never synced")
    expect(formatLastSynced(now - 5_000, now)).toBe("Synced just now")
    expect(formatLastSynced(now - 60_000, now)).toBe("Synced 1 minute ago")
    expect(formatLastSynced(now - 20 * 60_000, now)).toBe("Synced 20 minutes ago")
    expect(formatLastSynced(now - 3 * 3_600_000, now)).toBe("Synced 3 hours ago")
    expect(formatLastSynced(now - DAY, now)).toBe("Last synced 1 day ago")
    expect(formatLastSynced(now - 4 * DAY, now)).toBe("Last synced 4 days ago")
    // A clock from a device with a skewed future date must not read "-1 days".
    expect(formatLastSynced(now + 10_000, now)).toBe("Synced just now")
  })
})

describe("markSynced from the sync paths", () => {
  it("a manual syncNow() sets the clock", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock())
    configureTransport()
    mockFetch(okPush)
    const before = Date.now()
    const result = await autoSync.syncNow()
    expect(result.kind).toBe("pushed")
    expect(getLastSyncedAt()).toBeGreaterThanOrEqual(before)
  })

  it("a stale push leaves the clock alone", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock())
    configureTransport()
    mockFetch(() => new Response(null, { status: 412 }))
    const result = await autoSync.syncNow()
    expect(result.kind).toBe("stale")
    expect(getLastSyncedAt()).toBeNull()
  })

  it("pulling the cloud copy also counts as synced", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock())
    configureTransport()
    const { serialize } = await import("@lift/core/store/blob")
    const bytes = await serialize(snapshotWithData())
    mockFetch(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { etag: '"etag-9"' },
        })
    )
    expect(await autoSync.pullAndReplace()).toBe(true)
    expect(getLastSyncedAt()).not.toBeNull()
  })
})

describe("maybeAutoSync", () => {
  it("does nothing when sync isn't configured", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock())
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "skipped", reason: "not-configured" })
  })

  it("refuses to push an empty store over the cloud copy", async () => {
    resetStore() // hydrated, but no workouts
    configureSyncClock(memoryClock(String(Date.now() - 10 * DAY)))
    configureTransport()
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "skipped", reason: "empty" })
  })

  it("stays quiet until the first manual sync", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock())
    configureTransport()
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "skipped", reason: "never-synced" })
  })

  it("does nothing when the last sync is under a day old", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - DAY + 60_000)))
    configureTransport()
    mockFetch(() => {
      throw new Error("must not reach the network")
    })
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "skipped", reason: "not-due" })
  })

  it("pushes once the clock is a day old, and resets it", async () => {
    loadSnapshot(snapshotWithData())
    const store = memoryClock(String(Date.now() - DAY - 1000))
    configureSyncClock(store)
    configureTransport()
    mockFetch(okPush)
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "synced" })
    expect(getLastSyncedAt()).toBeGreaterThan(Date.now() - 5_000)
    // Next open is no longer due.
    expect(await autoSync.maybeAutoSync()).toEqual({
      kind: "skipped",
      reason: "not-due",
    })
  })

  it("a manual sync counts, so the auto check skips afterwards", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - 10 * DAY)))
    configureTransport()
    mockFetch(okPush)
    await autoSync.syncNow()
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "skipped", reason: "not-due" })
  })

  it("offline: fails silently, keeps the clock, and backs off", async () => {
    loadSnapshot(snapshotWithData())
    const stale = String(Date.now() - 5 * DAY)
    const store = memoryClock(stale)
    configureSyncClock(store)
    configureTransport()
    let attempts = 0
    mockFetch(() => {
      attempts++
      return Promise.reject(new TypeError("Failed to fetch"))
    })
    const first = await autoSync.maybeAutoSync()
    expect(first.kind).toBe("failed")
    // The clock never moved, so the sync is still due...
    expect((await loadSyncClock()).lastSyncedAt).toBe(Number(stale))
    expect(store.value()).toBe(stale)
    // ...but the retry cooldown keeps the app off the network.
    const second = await autoSync.maybeAutoSync()
    expect(second).toEqual({ kind: "skipped", reason: "cooling-down" })
    expect(attempts).toBe(1)
  })

  it("reports a stale cloud without moving the clock", async () => {
    loadSnapshot(snapshotWithData())
    const stale = String(Date.now() - 5 * DAY)
    configureSyncClock(memoryClock(stale))
    configureTransport()
    mockFetch(() => stalePush("cloud-v2"))
    const r = await autoSync.maybeAutoSync()
    expect(r).toEqual({ kind: "stale" })
    // Still due: the user resolves the conflict from the Sync screen.
    expect(getLastSyncedAt()).toBe(Number(stale))
    expect(getSyncClock().cloudNewerEtag).toBe("cloud-v2")
  })

  it("stops pushing while a conflict is unresolved", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - 5 * DAY)))
    configureTransport()
    let attempts = 0
    mockFetch(() => {
      attempts++
      return stalePush("cloud-v2")
    })
    expect((await autoSync.maybeAutoSync()).kind).toBe("stale")
    autoSync._resetAutoSyncState() // ignore the retry cooldown
    const second = await autoSync.maybeAutoSync()
    expect(second).toEqual({ kind: "skipped", reason: "cloud-newer" })
    // A retry could only fail the same way, so it never reaches the network.
    expect(attempts).toBe(1)
  })

  it("an over-quota response fails quietly", async () => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - 5 * DAY)))
    configureTransport()
    mockFetch(
      () =>
        new Response(JSON.stringify({ quota: { ...QUOTA, remaining: 0 } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
    )
    const r = await autoSync.maybeAutoSync()
    expect(r.kind).toBe("failed")
  })
})

describe("the cloud-is-newer prompt", () => {
  beforeEach(() => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - 5 * DAY)))
    configureTransport()
  })

  it("asks once per cloud version, and not again for the same one", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.maybeAutoSync()
    expect(hasCloudConflict()).toBe(true)
    expect(shouldPromptCloudNewer()).toBe(true)

    markCloudNewerPrompted()
    expect(shouldPromptCloudNewer()).toBe(false)
    // Still in conflict, so the quiet marker stays.
    expect(hasCloudConflict()).toBe(true)

    // Another refused push against the same cloud version must stay quiet.
    autoSync._resetAutoSyncState()
    markCloudNewer("cloud-v2")
    expect(shouldPromptCloudNewer()).toBe(false)
  })

  it("asks again when the cloud changes to a new version", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.maybeAutoSync()
    markCloudNewerPrompted()
    expect(shouldPromptCloudNewer()).toBe(false)

    // A third device pushed again: new information, so speak up.
    markCloudNewer("cloud-v3")
    expect(shouldPromptCloudNewer()).toBe(true)
  })

  it("asks once when the server reports no etag", async () => {
    mockFetch(() => stalePush(null))
    await autoSync.maybeAutoSync()
    expect(shouldPromptCloudNewer()).toBe(true)
    markCloudNewerPrompted()
    expect(shouldPromptCloudNewer()).toBe(false)
    markCloudNewer(null)
    expect(shouldPromptCloudNewer()).toBe(false)
  })

  it("a manual sync records the conflict too", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    const result = await autoSync.syncNow()
    expect(result).toEqual({ kind: "stale", remoteEtag: "cloud-v2" })
    expect(shouldPromptCloudNewer()).toBe(true)
  })

  it("resolving clears the conflict and the prompt", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.maybeAutoSync()
    markCloudNewerPrompted()

    mockFetch(okPush)
    autoSync._resetAutoSyncState()
    await autoSync.forcePush().catch(() => {})
    expect(hasCloudConflict()).toBe(false)
    expect(shouldPromptCloudNewer()).toBe(false)
    expect(getSyncClock().lastSyncedAt).not.toBeNull()
  })

  it("survives a restart: the record is on disk", async () => {
    const store = memoryClock(String(Date.now() - 5 * DAY))
    configureSyncClock(store)
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.maybeAutoSync()
    markCloudNewerPrompted()

    // Re-configure with the same backing value, as a fresh process would.
    const restarted = memoryClock(store.value())
    configureSyncClock(restarted)
    await loadSyncClock()
    expect(hasCloudConflict()).toBe(true)
    expect(shouldPromptCloudNewer()).toBe(false)
  })
})

describe("an explicit Sync now always answers", () => {
  beforeEach(() => {
    loadSnapshot(snapshotWithData())
    configureSyncClock(memoryClock(String(Date.now() - 5 * DAY)))
    configureTransport()
  })

  it("re-opens the prompt the user already dismissed", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.maybeAutoSync()
    markCloudNewerPrompted()
    expect(shouldPromptCloudNewer()).toBe(false)

    // The user presses Sync now. The server refuses again, and a silent
    // refusal would look like a dead button.
    const result = await autoSync.syncNow()
    expect(result.kind).toBe("stale")
    requestCloudNewerPrompt()
    expect(shouldPromptCloudNewer()).toBe(true)
  })

  it("the re-opened prompt still closes for good once shown", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.syncNow()
    requestCloudNewerPrompt()
    markCloudNewerPrompted()
    expect(shouldPromptCloudNewer()).toBe(false)
    // A background check afterwards stays quiet.
    autoSync._resetAutoSyncState()
    await autoSync.maybeAutoSync()
    expect(shouldPromptCloudNewer()).toBe(false)
  })

  it("does nothing when there is no conflict to show", async () => {
    mockFetch(okPush)
    await autoSync.syncNow()
    requestCloudNewerPrompt()
    expect(shouldPromptCloudNewer()).toBe(false)
  })

  it("a request does not survive a resolve", async () => {
    mockFetch(() => stalePush("cloud-v2"))
    await autoSync.syncNow()
    requestCloudNewerPrompt()
    mockFetch(okPush)
    await autoSync.forcePush()
    expect(shouldPromptCloudNewer()).toBe(false)
    expect(hasCloudConflict()).toBe(false)
  })
})
