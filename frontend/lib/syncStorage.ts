/**
 * Device-local storage for the two facts sync needs between sessions: the R2
 * etag and the "last synced" timestamp.
 *
 * Both are best-effort. Safari private mode throws on localStorage writes, so
 * every access is guarded — a failure degrades the feature, it never breaks a
 * sync. Both are cleared on login/signup/logout, exactly like the token.
 */

import type { SyncClockStore } from "@lift/core"

const ETAG_KEY = "lift.sync.etag"
const CLOCK_KEY = "lift.sync.lastSyncedAt"

function read(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Quota or private mode — the next session just re-learns the value.
  }
}

/**
 * The etag the last push/pull returned. Without it, every push after a page
 * reload sends If-None-Match:* and the server answers 412, so the user gets
 * the "cloud is newer" prompt for a conflict that doesn't exist. Mobile has
 * persisted it since day one (AuthProvider's ETAG_KEY); this matches.
 */
export function readStoredEtag(): string | null {
  return read(ETAG_KEY)
}

export function writeStoredEtag(etag: string | null): void {
  write(ETAG_KEY, etag)
}

export const webSyncClockStore: SyncClockStore = {
  async get() {
    return read(CLOCK_KEY)
  },
  async set(value: string) {
    write(CLOCK_KEY, value)
  },
  async clear() {
    write(CLOCK_KEY, null)
  },
}
