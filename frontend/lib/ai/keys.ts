import { useSyncExternalStore } from "react"
import type { AIProviderId } from "@lift/core"

// API keys are stored in localStorage on the web. Note: localStorage is
// readable by any script on the same origin — users should be aware of the
// trade-off before pasting a key here.
function keyFor(id: AIProviderId): string {
  return `ai_key_${id}`
}

export function getApiKey(id: AIProviderId): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(keyFor(id))
  } catch {
    return null
  }
}

export function setApiKey(id: AIProviderId, value: string): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(keyFor(id), value)
  notifyKeysChanged()
}

export function clearApiKey(id: AIProviderId): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(keyFor(id))
  notifyKeysChanged()
}

// Key presence as an external store, so pages re-render when a key is saved
// or cleared (here or in another tab) without mirroring it into state.
const KEYS_EVENT = "lift:ai-keys"

function notifyKeysChanged() {
  window.dispatchEvent(new Event(KEYS_EVENT))
}

function subscribeKeys(cb: () => void): () => void {
  window.addEventListener(KEYS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(KEYS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

/** Whether a key is saved for `id`. False while rendering on the server. */
export function useHasApiKey(id: AIProviderId): boolean {
  return useSyncExternalStore(subscribeKeys, () => !!getApiKey(id), () => false)
}

/** The providers that have a key saved, as a stable comma-joined string
 *  (useSyncExternalStore needs a value that compares equal when unchanged). */
export function useSavedKeyIds(ids: readonly AIProviderId[]): string {
  return useSyncExternalStore(
    subscribeKeys,
    () => ids.filter((id) => !!getApiKey(id)).join(","),
    () => ""
  )
}
