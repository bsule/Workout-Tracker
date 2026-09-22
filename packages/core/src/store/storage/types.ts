/**
 * What a written snapshot holds, counted by the caller that already has the
 * parsed snapshot in hand. Adapters that keep restore points store it next to
 * each file, so a list of them never has to gunzip the blobs.
 */
export interface SnapshotStats {
  savedAt: string
  workouts: number
  sets: number
}

export interface BlobStorage {
  readSnapshot(): Promise<Uint8Array | null>
  /**
   * Optional, for adapters that keep older copies: one loader per copy,
   * newest first. hydrate() tries each until one parses, so a file that
   * reads but does not decode falls back too. Loaders run only as needed.
   */
  snapshotCandidates?(): Array<() => Promise<Uint8Array | null>>
  /**
   * Optional, with snapshotCandidates: called with the indexes of copies that
   * did not load, before hydrate writes the copy that did. Moving them aside
   * keeps a damaged file out of the restore slots the write rotates.
   */
  discardSnapshotCopies?(indexes: number[]): Promise<void>
  writeSnapshot(bytes: Uint8Array, stats?: SnapshotStats): Promise<void>
  appendPending(line: string): Promise<void>
  readPending(): Promise<string[]>
  clearPending(): Promise<void>
}
