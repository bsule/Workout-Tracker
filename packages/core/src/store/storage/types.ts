export interface BlobStorage {
  readSnapshot(): Promise<Uint8Array | null>
  writeSnapshot(bytes: Uint8Array): Promise<void>
  appendPending(line: string): Promise<void>
  readPending(): Promise<string[]>
  clearPending(): Promise<void>
}
