import { useMemo, useSyncExternalStore } from "react"
import { useNavigation } from "@react-navigation/native"
import { getState, subscribe } from "@lift/core/store/store"
import { createFocusedStore } from "./focusedStore"

const source = { getSnapshot: () => getState().snapshot, subscribe }

/** Screen-local data; app-level saving, sync and settings stay subscribed. */
export function useScreenSnapshot() {
  const navigation = useNavigation()
  const store = useMemo(() => createFocusedStore(navigation, source), [navigation])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
