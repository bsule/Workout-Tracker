/**
 * SyncTransport backed by the lift-api Worker (Hono on Cloudflare).
 *
 * Wire format:
 *   GET  /api/sync/snapshot          → 200 raw bytes + ETag header, or 204
 *   PUT  /api/sync/snapshot          → 200 { etag, quota }, 412 stale, 428 missing precondition, 429 over limit
 *   GET  /api/sync/quota             → 200 { used, limit, remaining, resets_at }
 *
 * Auth: Authorization: Token <hex>.
 *
 * Push is rate-limited server-side (5/day per user, UTC). Failed pushes
 * (412) don't count against the budget. Pulls are unrestricted.
 */

import type { SyncTransport } from "./index"

export interface Quota {
  used: number
  limit: number
  remaining: number
  resets_at: string
}

export class StaleSnapshotError extends Error {
  constructor() {
    super("Remote snapshot has changed; pull and retry.")
    this.name = "StaleSnapshotError"
  }
}

export class SyncQuotaExceededError extends Error {
  quota: Quota
  constructor(quota: Quota) {
    super(`Daily sync limit reached (${quota.limit}/day). Resets at ${quota.resets_at}.`)
    this.name = "SyncQuotaExceededError"
    this.quota = quota
  }
}

export interface CloudflareTransportOptions {
  apiBase: string
  getToken: () => string | null | Promise<string | null>
}

export class CloudflareTransport implements SyncTransport {
  private readonly apiBase: string
  private readonly getToken: CloudflareTransportOptions["getToken"]
  private lastEtag: string | null = null
  private lastQuota: Quota | null = null

  constructor(opts: CloudflareTransportOptions) {
    this.apiBase = opts.apiBase.replace(/\/+$/, "")
    this.getToken = opts.getToken
  }

  setEtag(etag: string | null): void {
    this.lastEtag = etag
  }

  getEtag(): string | null {
    return this.lastEtag
  }

  /** Last-known quota, populated by getQuota() / pushSnapshot(). */
  getCachedQuota(): Quota | null {
    return this.lastQuota
  }

  async getQuota(): Promise<Quota> {
    const headers = await this.authHeaders()
    const res = await fetch(`${this.apiBase}/sync/quota`, { headers })
    if (!res.ok) throw new Error(`getQuota failed: ${res.status}`)
    const quota = (await res.json()) as Quota
    this.lastQuota = quota
    return quota
  }

  async pullSnapshot(): Promise<{ bytes: Uint8Array; etag: string } | null> {
    const headers = await this.authHeaders()
    const res = await fetch(`${this.apiBase}/sync/snapshot`, { headers })
    if (res.status === 204) {
      this.lastEtag = null
      return null
    }
    if (!res.ok) throw new Error(`pull failed: ${res.status}`)
    const etag = stripQuotes(res.headers.get("etag") ?? "")
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    this.lastEtag = etag
    return { bytes, etag }
  }

  async pushSnapshot(bytes: Uint8Array): Promise<{ etag: string }> {
    const headers = await this.authHeaders()
    headers.set("Content-Type", "application/octet-stream")
    if (this.lastEtag) {
      headers.set("If-Match", `"${this.lastEtag}"`)
    } else {
      headers.set("If-None-Match", "*")
    }

    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const res = await fetch(`${this.apiBase}/sync/snapshot`, {
      method: "PUT",
      headers,
      body,
    })

    if (res.status === 412) throw new StaleSnapshotError()
    if (res.status === 429) {
      const data = (await res.json().catch(() => null)) as { quota?: Quota } | null
      if (data?.quota) {
        this.lastQuota = data.quota
        throw new SyncQuotaExceededError(data.quota)
      }
      throw new Error("rate limited")
    }
    if (!res.ok) throw new Error(`push failed: ${res.status}`)
    const data = (await res.json()) as { etag: string; quota: Quota }
    this.lastEtag = data.etag
    this.lastQuota = data.quota
    return { etag: data.etag }
  }

  private async authHeaders(): Promise<Headers> {
    const token = await this.getToken()
    const headers = new Headers()
    if (token) headers.set("Authorization", `Token ${token}`)
    return headers
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^"/, "").replace(/"$/, "")
}
