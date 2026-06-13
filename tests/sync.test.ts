import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  CloudflareTransport,
  StaleSnapshotError,
  SyncQuotaExceededError,
} from "@lift/core"

interface FetchCall {
  url: string
  init: RequestInit
}

let calls: FetchCall[]
const realFetch = globalThis.fetch

function mockFetch(handler: (call: FetchCall) => Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
}

function transport() {
  const etags: (string | null)[] = []
  const t = new CloudflareTransport({
    apiBase: "http://localhost:8787/api/",
    getToken: () => "secret-token",
    onEtagChange: (e) => etags.push(e),
  })
  return { t, etags }
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const QUOTA = { used: 1, limit: 5, remaining: 4, resets_at: "2026-01-02T00:00:00Z" }

describe("pullSnapshot", () => {
  it("returns null and clears the etag on 204", async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    const { t, etags } = transport()
    t.setEtag("stale") // pretend we held an etag from a prior session
    etags.length = 0
    const result = await t.pullSnapshot()
    expect(result).toBeNull()
    expect(t.getEtag()).toBeNull()
    expect(etags).toContain(null) // listener fired with the cleared value
  })

  it("returns bytes + etag on 200 and notifies the etag listener", async () => {
    const body = new Uint8Array([1, 2, 3, 4])
    mockFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { etag: '"abc123"' },
        })
    )
    const { t, etags } = transport()
    const result = await t.pullSnapshot()
    expect(result?.etag).toBe("abc123") // quotes stripped
    expect(Array.from(result!.bytes)).toEqual([1, 2, 3, 4])
    expect(etags).toContain("abc123")
    expect(t.getEtag()).toBe("abc123")
  })

  it("sends the bearer token", async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    const { t } = transport()
    await t.pullSnapshot()
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("authorization")).toBe("Token secret-token")
  })
})

describe("pushSnapshot", () => {
  it("uses If-None-Match: * on a first push and returns the new etag", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ etag: "v1", quota: QUOTA }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
    const { t } = transport()
    const result = await t.pushSnapshot(new Uint8Array([9, 9]))
    expect(result.etag).toBe("v1")

    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("if-none-match")).toBe("*")
    expect(headers.get("if-match")).toBeNull()
    expect(calls[0].init.method).toBe("PUT")
    expect(t.getCachedQuota()).toEqual(QUOTA)
  })

  it("uses If-Match with the known etag on a subsequent push", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ etag: "v2", quota: QUOTA }), {
          status: 200,
        })
    )
    const { t } = transport()
    t.setEtag("v1")
    await t.pushSnapshot(new Uint8Array([1]))
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("if-match")).toBe('"v1"')
  })

  it("throws StaleSnapshotError on 412", async () => {
    mockFetch(() => new Response(null, { status: 412 }))
    const { t } = transport()
    await expect(t.pushSnapshot(new Uint8Array([1]))).rejects.toBeInstanceOf(
      StaleSnapshotError
    )
  })

  it("throws SyncQuotaExceededError with quota detail on 429", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ quota: QUOTA }), {
          status: 429,
        })
    )
    const { t } = transport()
    await expect(t.pushSnapshot(new Uint8Array([1]))).rejects.toMatchObject({
      name: "SyncQuotaExceededError",
      quota: QUOTA,
    })
  })

  it("throws a generic error on other non-ok statuses", async () => {
    mockFetch(() => new Response(null, { status: 500 }))
    const { t } = transport()
    await expect(t.pushSnapshot(new Uint8Array([1]))).rejects.toThrow(/push failed: 500/)
  })
})

describe("getQuota", () => {
  it("fetches and caches the quota", async () => {
    mockFetch(() => new Response(JSON.stringify(QUOTA), { status: 200 }))
    const { t } = transport()
    const q = await t.getQuota()
    expect(q).toEqual(QUOTA)
    expect(t.getCachedQuota()).toEqual(QUOTA)
    expect(calls[0].url).toBe("http://localhost:8787/api/sync/quota")
  })
})

describe("SyncQuotaExceededError", () => {
  it("is an instance check that survives across imports", () => {
    const err = new SyncQuotaExceededError(QUOTA)
    expect(err).toBeInstanceOf(SyncQuotaExceededError)
    expect(err.quota.limit).toBe(5)
  })
})
