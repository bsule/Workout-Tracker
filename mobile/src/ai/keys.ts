import * as SecureStore from "expo-secure-store"
import type { AIProviderId } from "@lift/core"

function keyFor(id: AIProviderId): string {
  return `ai_key_${id}`
}

export async function getApiKey(id: AIProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyFor(id))
  } catch {
    return null
  }
}

export async function setApiKey(id: AIProviderId, value: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(id), value)
}

export async function clearApiKey(id: AIProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(id))
}
