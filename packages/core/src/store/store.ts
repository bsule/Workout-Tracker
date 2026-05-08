import { useSyncExternalStore } from "react"
import { buildIndexes, type Indexes } from "./indexes"
import { emptySnapshot, type Snapshot } from "./schema"
import { newDeviceId, seedIdCounter } from "./ids"

export interface StoreState {
  snapshot: Snapshot
  indexes: Indexes
  hydrated: boolean
  local_dirty_since: string | null
}

type Listener = () => void

let state: StoreState = initial()
const listeners = new Set<Listener>()

function initial(): StoreState {
  const snap = emptySnapshot(newDeviceId())
  return {
    snapshot: snap,
    indexes: buildIndexes(snap),
    hydrated: false,
    local_dirty_since: null,
  }
}

export function getState(): StoreState {
  return state
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function emit() {
  for (const l of listeners) l()
}

export function setSnapshot(next: Snapshot, opts: { dirty?: boolean } = {}) {
  state = {
    snapshot: next,
    indexes: buildIndexes(next),
    hydrated: true,
    local_dirty_since: opts.dirty
      ? new Date().toISOString()
      : state.local_dirty_since,
  }
  seedFromSnapshot(next)
  emit()
}

export function applyMutation(mutator: (snap: Snapshot) => Snapshot) {
  const next = mutator(state.snapshot)
  state = {
    snapshot: next,
    indexes: buildIndexes(next),
    hydrated: true,
    local_dirty_since: new Date().toISOString(),
  }
  emit()
}

export function markHydrated(snap: Snapshot) {
  state = {
    snapshot: snap,
    indexes: buildIndexes(snap),
    hydrated: true,
    local_dirty_since: null,
  }
  seedFromSnapshot(snap)
  emit()
}

export function clearDirty() {
  if (state.local_dirty_since == null) return
  state = { ...state, local_dirty_since: null }
  emit()
}

function seedFromSnapshot(snap: Snapshot) {
  let max = 0
  for (const e of snap.exercises) if (e.id > max) max = e.id
  for (const w of snap.workouts) if (w.id > max) max = w.id
  for (const we of snap.workout_exercises) if (we.id > max) max = we.id
  for (const s of snap.sets) if (s.id > max) max = s.id
  for (const g of snap.gyms) if (g.id > max) max = g.id
  seedIdCounter(max)
}

// React hook ----------------------------------------------------------

const serverSnapshot = state
export function useStore<T>(selector: (s: StoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(serverSnapshot)
  )
}

export function useHydrated(): boolean {
  return useStore((s) => s.hydrated)
}
