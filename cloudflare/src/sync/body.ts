/** Compressed snapshots are normally well below this bound, even with years
 * of history. Bound actual streamed bytes as well as Content-Length. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

export class SnapshotTooLargeError extends Error {
  constructor() { super("Snapshot exceeds the 8 MiB upload limit.") }
}

export async function readSnapshotBody(request: Request, limit = MAX_SNAPSHOT_BYTES): Promise<ArrayBuffer> {
  if (Number(request.headers.get("content-length")) > limit) {
    await request.body?.cancel()
    throw new SnapshotTooLargeError()
  }
  if (!request.body) return new ArrayBuffer(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new SnapshotTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes.buffer
}
