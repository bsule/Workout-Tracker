interface FocusSource {
  isFocused(): boolean
  addListener(event: "focus", listener: () => void): () => void
}

const returnListeners = new Map<string, Set<() => void>>()

type ReturnState = {
  index?: number
  routes: readonly { key?: string; state?: ReturnState }[]
}

/** Resolve the destination before a pop, or after a native pop updated state. */
export function getReturnRouteKey(
  state: ReturnState | undefined,
  departingKey: string,
  returnRouteKey?: string
): string | undefined {
  if (returnRouteKey != null) return returnRouteKey
  if (!state) return undefined
  const departingIndex = state.routes.findIndex((route) => route.key === departingKey)
  const index = departingIndex < 0 ? (state.index ?? 0) : departingIndex - 1
  let route = state.routes[index]
  // Main contains tabs: only the selected tab is about to become visible.
  while (route?.state) route = route.state.routes[route.state.index ?? 0]
  return route?.key
}

/** Refresh only the route about to be revealed, including its visible page. */
export function prepareScreenReturn(routeKey: string | undefined) {
  if (routeKey == null) return
  for (const listener of returnListeners.get(routeKey) ?? []) listener()
}

export function subscribeScreenReturn(routeKey: string, listener: () => void): () => void {
  let listeners = returnListeners.get(routeKey)
  if (!listeners) {
    listeners = new Set()
    returnListeners.set(routeKey, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) returnListeners.delete(routeKey)
  }
}

/**
 * Keep covered screens out of external-store updates. Native-stack's Fabric
 * implementation deliberately does not freeze the screen below the top one,
 * so freezeOnBlur alone still lets its lists render on every logged set.
 *
 * Read focus at notification time (not from a React effect): a delete can land
 * between navigation changing focus and the covered screen rendering again.
 */
export function createFocusedStore<T>(
  navigation: FocusSource,
  source: { getSnapshot(): T; subscribe(listener: () => void): () => void },
  subscribeReturn?: (listener: () => void) => () => void
) {
  let snapshot = source.getSnapshot()
  return {
    getSnapshot() {
      if (navigation.isFocused()) snapshot = source.getSnapshot()
      return snapshot
    },
    subscribe(listener: () => void) {
      const notify = () => {
        if (navigation.isFocused()) listener()
      }
      const unsubscribeStore = source.subscribe(notify)
      // Catch up on return, including changes made while the screen was
      // covered. useSyncExternalStore checks again after subscribing too.
      const unsubscribeFocus = navigation.addListener("focus", notify)
      // One catch-up on departure, not a live background subscription. Keep
      // the refreshed snapshot readable even before navigation gains focus.
      const unsubscribeReturn = subscribeReturn?.(() => {
        const next = source.getSnapshot()
        if (Object.is(snapshot, next)) return
        snapshot = next
        listener()
      })
      return () => {
        unsubscribeStore()
        unsubscribeFocus()
        unsubscribeReturn?.()
      }
    },
  }
}
