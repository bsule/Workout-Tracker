/**
 * A stable id for this install, sent with every push so the worker can tell
 * this device's own writes from another device's (cloudflare/src/sync/ownWrite.ts).
 *
 * It is NOT the snapshot's device_id: that one travels inside the snapshot, so
 * pulling the cloud copy would hand this device another device's id. This one
 * lives in device storage and survives sign-out, because it names the install,
 * not the account.
 *
 * Hosts pass their storage the same way they inject BlobStorage and the sync
 * clock: web localStorage, mobile AsyncStorage.
 */

import { newDeviceId } from "../store/ids"

export interface DeviceIdStore {
  get(): Promise<string | null> | string | null
  set(value: string): Promise<void> | void
}

/** Matches what the worker accepts; anything else is replaced. */
const VALID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Returns a getter for CloudflareTransport's getDeviceId. The first call reads
 * the stored id, or makes and stores one. Later calls answer from memory.
 *
 * Never throws. Storage that cannot be read or written still yields an id for
 * this session; a later session then gets a different one, which costs only
 * the recovery of a reply lost across that restart.
 */
export function createDeviceIdSource(store: DeviceIdStore): () => Promise<string> {
  let pending: Promise<string> | null = null
  return () => {
    pending ??= load(store)
    return pending
  }
}

async function load(store: DeviceIdStore): Promise<string> {
  let stored: string | null = null
  try {
    stored = await store.get()
  } catch {
    stored = null
  }
  if (stored && VALID.test(stored)) return stored
  const id = newDeviceId()
  try {
    await store.set(id)
  } catch {
    // Keep using the id for this session.
  }
  return id
}
