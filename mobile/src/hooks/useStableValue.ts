import { useRef } from "react"

/**
 * Returns the previous value while `same(prev, next)` holds, so a memoized
 * child that receives it sees an unchanged prop. The ref is written during
 * render, which is safe here: the write is idempotent for a given input.
 */
export function useStableValue<T>(next: T, same: (a: T, b: T) => boolean): T {
  const ref = useRef(next)
  if (ref.current !== next && !same(ref.current, next)) ref.current = next
  return ref.current
}
