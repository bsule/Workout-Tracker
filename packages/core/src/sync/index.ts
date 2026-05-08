/**
 * Sync transport stub. The local-first store remains the source of truth; this
 * module is the boundary where a future Cloudflare R2 adapter will plug in.
 *
 * Wire-up plan when R2 lands:
 *   1. Backend exposes signed-URL endpoints to PUT/GET a per-user snapshot blob.
 *   2. R2Transport implements SyncTransport using fetch + the user's auth token.
 *   3. Host calls configureSync(new R2Transport({ apiBase, getToken }))
 *   4. App calls pushNow() after flushOnHide() and pullNow() at sign-in.
 *
 * The blob format is already snapshot-compatible (see store/blob.ts).
 */

import { parse, serialize } from "../store/blob"
import type { Snapshot } from "../store/schema"

export interface SyncTransport {
  pushSnapshot(bytes: Uint8Array): Promise<{ etag: string }>
  pullSnapshot(): Promise<{ bytes: Uint8Array; etag: string } | null>
}

let transport: SyncTransport | null = null

export function configureSync(t: SyncTransport | null) {
  transport = t
}

export function isSyncConfigured(): boolean {
  return transport !== null
}

export async function pushNow(snapshot: Snapshot): Promise<{ etag: string }> {
  if (!transport) throw new Error("sync transport not configured")
  const bytes = await serialize(snapshot)
  return transport.pushSnapshot(bytes)
}

export async function pullNow(): Promise<{ snapshot: Snapshot; etag: string } | null> {
  if (!transport) throw new Error("sync transport not configured")
  const result = await transport.pullSnapshot()
  if (!result) return null
  const snapshot = await parse(result.bytes)
  return { snapshot, etag: result.etag }
}
