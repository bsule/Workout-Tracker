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
  close?(): void
}

let transport: SyncTransport | null = null
let session = 0

export function configureSync(t: SyncTransport | null) {
  if (transport !== t) transport?.close?.()
  session++
  transport = t
}

export function captureSyncSession() {
  if (!transport) throw new Error("sync transport not configured")
  const captured = session
  const current = transport
  return { transport: current, check() {
    if (captured !== session) throw new Error("The sync account changed during the operation.")
  } }
}

export function isSyncConfigured(): boolean {
  return transport !== null
}

export async function pushNow(snapshot: Snapshot): Promise<{ etag: string }> {
  const operation = captureSyncSession()
  const bytes = await serialize(snapshot)
  operation.check()
  const result = await operation.transport.pushSnapshot(bytes)
  operation.check()
  return result
}

export async function pullNow(): Promise<{ snapshot: Snapshot; etag: string } | null> {
  const operation = captureSyncSession()
  const result = await operation.transport.pullSnapshot()
  operation.check()
  if (!result) return null
  const { snapshot } = await parse(result.bytes)
  operation.check()
  return { snapshot, etag: result.etag }
}

/**
 * Internal: returns the raw remote bytes + etag without parsing. Used by
 * autoSync.pullAndReplace so the bytes can be handed straight to
 * replaceSnapshotFromBytes (which parses once) instead of double-parsing.
 */
export async function _internalPullBytes(): Promise<{ bytes: Uint8Array; etag: string } | null> {
  const operation = captureSyncSession()
  const result = await operation.transport.pullSnapshot()
  operation.check()
  return result
}

/** Returns the currently configured transport, or null. */
export function getTransport(): SyncTransport | null {
  return transport
}
