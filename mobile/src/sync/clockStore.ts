/**
 * AsyncStorage adapter for the core's "last synced" clock. Sits next to the
 * etag the AuthProvider already persists, and follows the same lifecycle:
 * configured on boot/login, cleared on login/signup/logout.
 *
 * Every method swallows its own error. A device with unwritable storage loses
 * the label, not the sync.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import type { SyncClockStore } from "@lift/core"

const CLOCK_KEY = "lift.sync.lastSyncedAt"

export const rnSyncClockStore: SyncClockStore = {
  async get() {
    try {
      return await AsyncStorage.getItem(CLOCK_KEY)
    } catch {
      return null
    }
  },
  async set(value: string) {
    try {
      await AsyncStorage.setItem(CLOCK_KEY, value)
    } catch {
      // Next successful sync writes it again.
    }
  },
  async clear() {
    try {
      await AsyncStorage.removeItem(CLOCK_KEY)
    } catch {
      // Nothing to do; the value is already treated as unknown in memory.
    }
  },
}
