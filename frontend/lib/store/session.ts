import { unloadStore } from "@lift/core"

// Auth, provider cleanup and lock release must join the same final save.
// No outgoing unload may finish after the next account starts hydrating.
let unloading: Promise<void> = Promise.resolve()

export function unloadWebStore(): Promise<void> {
  unloading = unloading.then(unloadStore).catch((error: unknown) => {
    console.error("Failed to unload the store", error)
  })
  return unloading
}

export function waitForWebUnload(): Promise<void> { return unloading }
