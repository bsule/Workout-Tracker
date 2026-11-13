import { useCallback, useContext } from "react"
import { NavigationContainerRefContext, useNavigation, useRoute } from "@react-navigation/native"
import { getReturnRouteKey, prepareScreenReturn } from "./focusedStore"

// Screens read engine queries through useScreenQueryOptions
// (../engine/screenQuery.ts), which keeps covered screens off the refetch.

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
