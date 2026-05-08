// Monotonic numeric IDs scoped to the local snapshot. We use numbers (not ULIDs)
// because the existing types/components assume `number`. The counter is seeded
// from the max id in the loaded snapshot so collisions don't happen across
// reloads.

let counter = 1

export function seedIdCounter(maxSeen: number) {
  counter = Math.max(counter, maxSeen + 1)
}

export function nextId(): number {
  return counter++
}

export function newDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`
}
