import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CloudflareTransport, autoSync, configureSyncClock } from "@lift/core"
import * as syncModule from "@lift/core/sync"
import { serialize } from "@lift/core/store/blob"
import * as M from "@lift/core/store/mutations"
import { blankSnapshot, workout } from "./helpers/build"
import { installMemoryStorage, resetStore } from "./helpers/store"

// Looking at the cloud copy (the conflict dialog and the restore screens show
// its date and counts) must not count as syncing with it. previewRemote used to
// adopt the cloud's etag, so the next "Sync now" sent a matching If-Match, the
// server accepted it, and the cloud copy from the other device was overwritten
// without a prompt. Taking the cloud copy (applyRemoteBytes) is what adopts it.

// A minimal cloud: one blob and its etag. A PUT whose If-Match is not the
// current etag is refused with 412, as the worker does.
let cloud: { bytes: Uint8Array; etag: string } | null
let version: number
const realFetch = globalThis.fetch

function installCloud() {
  version = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.endsWith("/sync/snapshot")) return new Response("not found", { status: 404 })
    if (!init?.method || init.method === "GET") {
      if (!cloud) return new Response(null, { status: 204 })
      return new Response(cloud.bytes, { status: 200, headers: { etag: `"${cloud.etag}"` } })
    }
    const headers = new Headers(init.headers)
    const ifMatch = headers.get("If-Match")?.replace(/"/g, "") ?? null
    const ifNoneMatch = headers.get("If-None-Match")
    const current = cloud?.etag ?? null
    const ok = ifNoneMatch === "*" ? current == null : ifMatch === current
    if (!ok) return Response.json({ etag: current }, { status: 412 })
    version++
    cloud = { bytes: new Uint8Array(init.body as ArrayBuffer), etag: `v${version}` }
    return Response.json({
      etag: cloud.etag,
      quota: { used: 1, limit: 5, remaining: 4, resets_at: "2026-01-02T00:00:00Z" },
    })
  }) as typeof fetch
}

let transport: CloudflareTransport

beforeEach(() => {
  installMemoryStorage()
  resetStore()
  configureSyncClock(null)
  autoSync._resetAutoSyncState()
  installCloud()
  cloud = null
  transport = new CloudflareTransport({
    apiBase: "http://localhost:8787/api",
    getToken: () => "secret-token",
  })
  syncModule.configureSync(transport)
})

afterEach(() => {
  globalThis.fetch = realFetch
  syncModule.configureSync(null)
})

/** Another device pushed a newer copy with this many workouts. */
async function otherDevicePushes(workouts: number) {
  const snap = blankSnapshot()
  snap.workouts = Array.from({ length: workouts }, (_, i) =>
    workout(900 + i, `2026-04-${String(i + 1).padStart(2, "0")}`)
  )
  version++
  cloud = { bytes: await serialize(snap), etag: `v${version}` }
}

describe("previewRemote", () => {
  it("does not let the next Sync now overwrite a newer cloud copy", async () => {
    M.createWorkout("2026-05-01")
    expect((await autoSync.syncNow()).kind).toBe("pushed")
    await otherDevicePushes(3)
    const otherDevices = cloud!.etag

    expect((await autoSync.syncNow()).kind).toBe("stale")
    // The conflict dialog reads the cloud copy to show what is in it...
    const preview = await autoSync.previewRemote()
    expect(preview?.workoutCount).toBe(3)
    // ...the user picks Later, then presses Sync now again: still refused.
    expect((await autoSync.syncNow()).kind).toBe("stale")
    expect(cloud!.etag).toBe(otherDevices)
  })

  it("leaves the device's etag as it was", async () => {
    M.createWorkout("2026-05-02")
    await autoSync.syncNow()
    const mine = transport.getEtag()
    await otherDevicePushes(1)
    await autoSync.previewRemote()
    expect(transport.getEtag()).toBe(mine)
  })

  it("adopts the previewed etag once the cloud copy is taken", async () => {
    M.createWorkout("2026-05-03")
    await autoSync.syncNow()
    await otherDevicePushes(2)
    const preview = await autoSync.previewRemote()
    await autoSync.applyRemoteBytes(preview!.bytes)
    expect(transport.getEtag()).toBe(cloud!.etag)
    // Local now is the cloud copy, so the next push goes through.
    M.createWorkout("2026-05-20")
    expect((await autoSync.syncNow()).kind).toBe("pushed")
  })

  it("keeps an empty cloud empty for the etag too", async () => {
    expect(await autoSync.previewRemote()).toBeNull()
    expect(transport.getEtag()).toBeNull()
  })
})
