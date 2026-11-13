/**
 * The one install id. Sync pushes carry it (`?device=`) and the engine stamps
 * it into the snapshot, so both must read the same value: two sources racing
 * on a fresh install could each mint their own.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createDeviceIdSource } from "@lift/core"

// Names this install, not the account, so sign-out leaves it in place.
const DEVICE_ID_KEY = "lift.sync.deviceId"

export const getDeviceId = createDeviceIdSource({
  get: () => AsyncStorage.getItem(DEVICE_ID_KEY),
  set: (id) => AsyncStorage.setItem(DEVICE_ID_KEY, id),
})

/** The etag the legacy JS sync transport kept. The engine adopts it only on
 *  the open that migrates an older store. */
export const LEGACY_ETAG_KEY = "lift.sync.etag"

export function readLegacyEtag(): Promise<string | null> {
  return AsyncStorage.getItem(LEGACY_ETAG_KEY).catch(() => null)
}

export function clearLegacyEtag(): void {
  AsyncStorage.removeItem(LEGACY_ETAG_KEY).catch(() => {})
}
