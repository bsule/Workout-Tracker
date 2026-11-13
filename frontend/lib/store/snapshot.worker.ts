import { gzipSync } from "fflate"
import type { Snapshot } from "@lift/core/store/schema"

// JSON encoding and compression both run here, outside the UI thread.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; snapshot: Snapshot }>) => void
  postMessage: (message: unknown, transfer: Transferable[]) => void
}
scope.onmessage = (event: MessageEvent<{ id: number; snapshot: Snapshot }>) => {
  const { id, snapshot } = event.data
  try {
    const bytes = gzipSync(new TextEncoder().encode(JSON.stringify(snapshot)))
    scope.postMessage({ id, bytes }, [bytes.buffer])
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, [])
  }
}
