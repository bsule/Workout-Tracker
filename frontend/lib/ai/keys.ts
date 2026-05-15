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
}

export function clearApiKey(id: AIProviderId): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(keyFor(id))
}
