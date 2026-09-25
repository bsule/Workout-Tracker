import type { Snapshot } from "./schema"

/**
 * Drops gym rows whose name repeats an earlier row exactly, keeping the
 * first. A Replace import used to add every saved gym a second time (it kept
 * the old list and matched against an empty one), which showed each gym twice
 * in the pickers. Workouts refer to a gym by name, not id, so nothing points
 * at a dropped row. Names that differ only in case are separate gyms and stay.
 * Returns the same snapshot when there is nothing to drop.
 */
export function dedupeGyms(snap: Snapshot): Snapshot {
  const seen = new Set<string>()
  let dropped = false
  const gyms = snap.gyms.filter((g) => {
    if (seen.has(g.name)) {
      dropped = true
      return false
    }
    seen.add(g.name)
    return true
  })
  return dropped ? { ...snap, gyms } : snap
}
