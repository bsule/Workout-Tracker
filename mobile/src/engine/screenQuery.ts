import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigation, useRoute } from "@react-navigation/native"
import type { QueryOptions } from "@lift/engine-client/react"
import { subscribeScreenReturn } from "../store/focusedStore"

/**
 * The engine equivalent of useScreenSnapshot: a covered screen keeps showing
 * its last result and does not refetch on every logged set. Native-stack's
 * Fabric implementation does not freeze the screen below the top one, so
 * freezeOnBlur alone would still refetch and re-render its lists.
 *
 * With `prepareOnReturn`, the screen catches up once when a screen above it
 * is about to pop (usePrepareScreenReturn), so it is current before the
 * native back transition reveals it.
 */
export function useScreenQueryOptions(prepareOnReturn = false): QueryOptions {
  const navigation = useNavigation()
  const route = useRoute()
  const [active, setActive] = useState(() => navigation.isFocused())
  useEffect(() => {
    const focus = navigation.addListener("focus", () => setActive(true))
    const blur = navigation.addListener("blur", () => setActive(false))
    // Focus can change between the first render and this effect.
    setActive(navigation.isFocused())
    return () => {
      focus()
      blur()
    }
  }, [navigation])
  const onReturn = useCallback(
    (listener: () => void) => subscribeScreenReturn(route.key, listener),
    [route.key]
  )
  return useMemo(
    () => ({ active, onReturn: prepareOnReturn ? onReturn : undefined }),
    [active, onReturn, prepareOnReturn]
  )
}
