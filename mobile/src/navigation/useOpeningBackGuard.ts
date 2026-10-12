import { useEffect, useLayoutEffect, useState } from "react"
import { CommonActions, useNavigation, usePreventRemove, type NavigationAction, type ParamListBase } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { createOpeningBackGuard, removeOriginatingPicker } from "./openingBackGuard"

/** Keep native swipe-back disabled until the logger push and picker cleanup finish. */
export function useOpeningBackGuard(pickerRouteKey?: string) {
  const enabled = Boolean(pickerRouteKey)
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>()
  const [opening, setOpening] = useState(enabled)
  const [guard] = useState(() => createOpeningBackGuard<NavigationAction>(enabled))

  // Swipe is disabled in the initial screen options. Remember early Back
  // button requests and replay after prevention and picker removal finish.
  usePreventRemove(opening, ({ data }) => guard.defer(data.action))

  useLayoutEffect(() => {
    if (!pickerRouteKey) return
    return navigation.addListener("transitionEnd", (event) => {
      if (!guard.finish(event.data.closing)) return
      // Remove the picker below the unchanged logger, even for early Back.
      navigation.dispatch((state) => CommonActions.reset(removeOriginatingPicker(state, pickerRouteKey)))
      setOpening(false)
    })
  }, [navigation, guard, pickerRouteKey])

  useEffect(() => {
    if (opening || !pickerRouteKey) return
    // Let native receive the cleared dismissal guard and let the logger's
    // departure/cleanup listeners rebind before replaying the action.
    const frame = requestAnimationFrame(() => {
      navigation.setOptions({ gestureEnabled: true })
      const action = guard.take()
      if (action) navigation.dispatch(action)
    })
    return () => cancelAnimationFrame(frame)
  }, [opening, navigation, guard, pickerRouteKey])

  return opening
}
