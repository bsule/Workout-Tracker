interface FocusSource {
  isFocused(): boolean
  addListener(event: "focus", listener: () => void): () => void
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
  source: { getSnapshot(): T; subscribe(listener: () => void): () => void }
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
      return () => {
        unsubscribeStore()
        unsubscribeFocus()
      }
    },
  }
}
