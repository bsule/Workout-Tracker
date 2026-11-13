import { expect, it, vi } from "vitest"
import { readSnapshotBody, SnapshotTooLargeError } from "../cloudflare/src/sync/body"

function request(chunks: number[][], contentLength?: string) {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk) controller.enqueue(new Uint8Array(chunk))
      else controller.close()
    }, cancel,
  })
  const req = new Request("https://example.test", { method: "PUT", body, duplex: "half", headers: contentLength ? { "Content-Length": contentLength } : {} } as RequestInit)
  return { req, cancel }
}
it("reads a snapshot exactly at the limit without altering bytes", async () => {
  expect(new Uint8Array(await readSnapshotBody(request([[1, 2], [3, 4]]).req, 4))).toEqual(new Uint8Array([1, 2, 3, 4]))
})
it.each([undefined, "1"])("bounds streamed bytes despite a missing or dishonest length (%s)", async length => {
  const { req, cancel } = request([[1, 2], [3, 4], [5]], length)
  await expect(readSnapshotBody(req, 3)).rejects.toBeInstanceOf(SnapshotTooLargeError)
  expect(cancel).toHaveBeenCalledOnce()
})
it("rejects an oversized Content-Length before reading", async () => {
  const { req, cancel } = request([[1]], "100")
  await expect(readSnapshotBody(req, 4)).rejects.toBeInstanceOf(SnapshotTooLargeError)
  expect(cancel).toHaveBeenCalledOnce()
})
