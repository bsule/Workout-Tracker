import { useCallback, useSyncExternalStore } from 'react'
import { EngineClient, type QueryState } from './index'

/** Pass a stable queryKey covering all arguments and an immutable query object. */
export function useEngineQuery<T>(client: EngineClient, queryKey: string, query: unknown): QueryState<T> {
  const subscribe=useCallback((listener:()=>void)=>client.subscribe(queryKey,query,listener),[client,queryKey,query])
  const getSnapshot=useCallback(()=>client.snapshot<T>(queryKey,query),[client,queryKey,query])
  return useSyncExternalStore(subscribe,getSnapshot,getSnapshot)
}
