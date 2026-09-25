import type { Snapshot } from "@lift/core/store/schema"

/**
 * Runs a store query (listExercisesQ, getExerciseHistoryQ, ...) for a given
 * snapshot. The queries read the store through getState(), so nothing in a
 * useMemo body would otherwise name the snapshot and the hooks lint calls it
 * an unnecessary dependency. Pass it here and list it in the deps:
 *
 *   const snapshot = useStore((s) => s.snapshot)
 *   const list = useMemo(() => queryAt(snapshot, () => listExercisesQ()), [snapshot])
 */
export function queryAt<T>(snapshot: Snapshot, query: () => T): T {
  void snapshot
  return query()
}
