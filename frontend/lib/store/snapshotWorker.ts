import type { Snapshot } from "@lift/core/store/schema"

type Encode = (snapshot: Snapshot) => Promise<Uint8Array>

/** One worker and independent replies: a sync upload and a disk save may
 * capture different snapshots concurrently.
 *
 * If the worker cannot start or stops (a blocked or missing script, a crash),
 * the waiting saves and every later one use `fallback` on the calling thread
 * for the rest of the page session. Without it, a broken worker would fail
 * every save, sync push and restore, and each retry would start another
 * failing worker. An encode error the worker reports for one snapshot is a
 * real failure of that save and is rejected; the worker stays in use. */
export function createSnapshotEncoder(createWorker: () => Worker, fallback: Encode): Encode {
  let worker: Worker | null = null
  let broken = false
  let sequence = 0
  const pending = new Map<number, {
    snapshot: Snapshot
    resolve: (bytes: Uint8Array) => void
    reject: (error: Error) => void
  }>()
  const encodeHere = (snapshot: Snapshot): Promise<Uint8Array> => {
    try { return fallback(snapshot) }
    catch (error) { return Promise.reject(error) }
  }
  const stopUsingWorker = (reason: string) => {
    if (broken) return
    broken = true
    console.warn(`Snapshot worker ${reason}. Saving on the main thread for this session.`)
    worker?.terminate()
    worker = null
    const waiting = [...pending.values()]
    pending.clear()
    for (const request of waiting) encodeHere(request.snapshot).then(request.resolve, request.reject)
  }
  return (snapshot: Snapshot): Promise<Uint8Array> => {
    if (broken) return encodeHere(snapshot)
    return new Promise((resolve, reject) => {
      if (!worker) {
        try {
          worker = createWorker()
        } catch (error) {
          console.error("Could not start the snapshot worker", error)
          stopUsingWorker("could not start")
          encodeHere(snapshot).then(resolve, reject)
          return
        }
        worker.onmessage = (event: MessageEvent<{ id: number; bytes?: Uint8Array; error?: string }>) => {
          const request = pending.get(event.data.id)
          if (!request) return
          pending.delete(event.data.id)
          if (event.data.bytes) request.resolve(event.data.bytes)
          else request.reject(new Error(event.data.error ?? "Snapshot encoding failed."))
        }
        worker.onerror = () => stopUsingWorker("stopped or failed to load")
        worker.onmessageerror = () => stopUsingWorker("returned unreadable data")
      }
      const id = ++sequence
      pending.set(id, { snapshot, resolve, reject })
      try {
        worker.postMessage({ id, snapshot })
      } catch {
        // This snapshot could not be sent; the worker itself is fine.
        pending.delete(id)
        encodeHere(snapshot).then(resolve, reject)
      }
    })
  }
}
