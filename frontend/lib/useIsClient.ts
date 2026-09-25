import { useSyncExternalStore } from "react"

const noSubscribe = () => () => {}

/** False while rendering on the server and during hydration, true after.
 *  For UI that depends on browser-only state (auth from localStorage). */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false)
}
