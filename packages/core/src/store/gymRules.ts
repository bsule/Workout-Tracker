import type { GymRow, Snapshot } from "./schema"

// Gym rules the live mutations and the crash-log replay in persist.ts share
// (persist cannot import mutations: that would be an import cycle).

/** The saved gym a typed name means: the exact name first, then the same
 *  name in another case ("golds" means a saved "Golds"). */
export function findSavedGym(gyms: readonly GymRow[], name: string): GymRow | undefined {
  const trimmed = name.trim()
  return (
    gyms.find((g) => g.name === trimmed) ??
    gyms.find((g) => g.name.toLowerCase() === trimmed.toLowerCase())
  )
}

/**
 * Renames gym `id` to `newName` (trimmed, already checked) and rewrites the
 * gym on every workout saved under its old name, including another spelling
 * of it ("golds" for "Golds") unless that spelling is a separate saved gym of
 * its own. Returns the same snapshot when the gym is missing.
 */
export function renameGymIn(snap: Snapshot, id: number, newName: string): Snapshot {
  const idx = snap.gyms.findIndex((g) => g.id === id)
  if (idx < 0) return snap
  const oldName = snap.gyms[idx].name
  const otherNames = new Set(snap.gyms.filter((_, i) => i !== idx).map((g) => g.name))
  const gyms = snap.gyms.slice()
  gyms[idx] = { ...gyms[idx], name: newName }
  const oldLower = oldName.toLowerCase()
  const workouts = snap.workouts.map((w) =>
    w.gym === oldName || (w.gym.toLowerCase() === oldLower && !otherNames.has(w.gym))
      ? { ...w, gym: newName }
      : w
  )
  return { ...snap, gyms, workouts }
}
