import type { NavigationState } from "@react-navigation/native"

/** Remove only the originating picker, preserving every other route and its key. */
export function removeOriginatingPicker(state: NavigationState, pickerRouteKey: string) {
  const index = state.routes.findIndex((route) => route.key === pickerRouteKey && route.name === "ExercisePicker")
  // Never remove an active route, or anything above the active logger.
  if (index < 0 || index >= state.index || state.routes[state.index]?.name !== "SetLogger") return state
  return {
    ...state,
    routes: state.routes.filter((_, routeIndex) => routeIndex !== index),
    index: state.index - 1,
  }
}

/** Hold one removal request until the screen's opening transition has finished. */
export function createOpeningBackGuard<Action>(enabled: boolean) {
  let opening = enabled
  let pending: Action | undefined
  return {
    defer(action: Action) {
      if (opening && pending === undefined) pending = action
    },
    finish(closing: boolean) {
      if (closing || !opening) return false
      opening = false
      return true
    },
    take() {
      if (opening) return undefined
      const action = pending
      pending = undefined
      return action
    },
  }
}
