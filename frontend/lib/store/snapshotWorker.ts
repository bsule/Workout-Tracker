import type { Snapshot } from "@lift/core/store/schema"

/** One worker and independent replies: a sync upload and a disk save may
 * capture different snapshots concurrently. A crashed worker rejects every
 * caller, then the next save creates a fresh one. */
export function createSnapshotEncoder(createWorker: () => Worker) {
  let worker: Worker | null = null
  let sequence = 0
  const pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>()
  const fail = (error: Error) => {
    worker?.terminate()
    worker = null
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  return (snapshot: Snapshot): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      try {
        if (!worker) {
          worker = createWorker()
          worker.onmessage = (event: MessageEvent<{ id: number; bytes?: Uint8Array; error?: string }>) => {
            const request = pending.get(event.data.id)
            if (!request) return
            pending.delete(event.data.id)
            if (event.data.bytes) request.resolve(event.data.bytes)
            else request.reject(new Error(event.data.error ?? "Snapshot encoding failed."))
          }
          worker.onerror = () => fail(new Error("Snapshot worker stopped. Please try saving again."))
          worker.onmessageerror = () => fail(new Error("Snapshot worker returned unreadable data."))
        }
        const id = ++sequence
        pending.set(id, { resolve, reject })
        try { worker.postMessage({ id, snapshot }) }
        catch (error) { pending.delete(id); throw error }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
