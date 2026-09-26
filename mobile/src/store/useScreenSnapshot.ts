import { useCallback, useContext, useMemo, useSyncExternalStore } from "react"
import { NavigationContainerRefContext, useNavigation, useRoute } from "@react-navigation/native"
import { getState, subscribe } from "@lift/core/store/store"
import { createFocusedStore, getReturnRouteKey, prepareScreenReturn, subscribeScreenReturn } from "./focusedStore"

const source = { getSnapshot: () => getState().snapshot, subscribe }

/** Screen-local data; app-level saving, sync and settings stay subscribed. */
export function useScreenSnapshot(prepareOnReturn = false) {
  const navigation = useNavigation()
  const route = useRoute()
  const store = useMemo(
    () => createFocusedStore(
      navigation,
      source,
      prepareOnReturn ? (listener) => subscribeScreenReturn(route.key, listener) : undefined
    ),
    [navigation, route.key, prepareOnReturn]
  )
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** Call after saving/cleanup and before goBack; also safe at pop transition start. */
export function usePrepareScreenReturn(returnRouteKey?: string) {
  const navigation = useNavigation()
  const container = useContext(NavigationContainerRefContext)
  const route = useRoute()
  return useCallback(() => {
    // Stack getState() can contain Main without its nested tab state.
    // getRootState() asks child navigators for their current state too, so
    // the destination is Today/Calendar/Exercises rather than bare Main.
    const state = container?.getRootState() ?? navigation.getState()
    prepareScreenReturn(getReturnRouteKey(state, route.key, returnRouteKey))
  }, [container, navigation, route.key, returnRouteKey])
}
