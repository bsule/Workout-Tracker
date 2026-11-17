import { Worker as NodeWorker } from "node:worker_threads"
import { build } from "esbuild"
import { afterEach, expect, it, vi } from "vitest"
import { createSnapshotEncoder } from "../frontend/lib/store/snapshotWorker"
import { encodeSnapshot, parse, serialize, setSnapshotEncoder } from "@lift/core/store/blob"
import { blankSnapshot, workout } from "./helpers/build"

afterEach(() => setSnapshotEncoder(null))

it("encodes a real snapshot in the worker and round trips the portable format", async () => {
  const bundled = await build({ entryPoints: ["frontend/lib/store/snapshot.worker.ts"], bundle: true, write: false, format: "iife", platform: "browser" })
  const worker = new NodeWorker(`const {parentPort} = require('node:worker_threads');
    globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
    parentPort.on('message', data => globalThis.onmessage({data}));
    ${bundled.outputFiles[0].text}`, { eval: true })
  const adapter = {
    onmessage: null as null | ((event: { data: unknown }) => void),
    onerror: null as null | (() => void), onmessageerror: null,
    postMessage: (value: unknown) => worker.postMessage(value), terminate: () => { void worker.terminate() },
  }
  worker.on("message", data => adapter.onmessage?.({ data }))
  worker.on("error", () => adapter.onerror?.())
  setSnapshotEncoder(createSnapshotEncoder(() => adapter as unknown as Worker, encodeSnapshot))
  try {
    const snapshot = blankSnapshot()
    snapshot.exported_at = "2000-01-01T00:00:00.000Z"
    snapshot.workouts = [workout(1, "2026-11-12")]
    const restored = (await parse(await serialize(snapshot))).snapshot
    expect(restored.workouts).toEqual(snapshot.workouts)
    expect(restored.exported_at).not.toBe(snapshot.exported_at)
  } finally { await worker.terminate() }
})

function fakeWorkers() {
  const workers: Worker[] = []
  const create = vi.fn(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null } as unknown as Worker
    workers.push(worker)
    return worker
  })
  return { workers, create }
}

it("finishes waiting saves on the main thread after a crash and stops starting workers", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const { workers, create } = fakeWorkers()
  const fallback = vi.fn(encodeSnapshot)
  const encode = createSnapshotEncoder(create, fallback)
  const snapshot = blankSnapshot()
  snapshot.workouts = [workout(1, "2026-11-12")]
  const first = encode(snapshot)
  const second = encode(blankSnapshot())
  workers[0].onerror!({} as ErrorEvent)
  expect((await parse(await first)).snapshot.workouts).toEqual(snapshot.workouts)
  await second
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  // The broken worker is not retried for the rest of the session.
  await encode(blankSnapshot())
  expect(create).toHaveBeenCalledOnce()
  expect(fallback).toHaveBeenCalledTimes(3)
  vi.restoreAllMocks()
})

it("saves on the main thread when the worker cannot be created", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  const create = vi.fn((): Worker => { throw new DOMException("blocked", "SecurityError") })
  const encode = createSnapshotEncoder(create, encodeSnapshot)
  expect((await parse(await encode(blankSnapshot()))).snapshot.workouts).toEqual([])
  await encode(blankSnapshot())
  expect(create).toHaveBeenCalledOnce()
  vi.restoreAllMocks()
})

it("rejects an encode error the worker reports and keeps using the worker", async () => {
  const { workers, create } = fakeWorkers()
  const fallback = vi.fn(encodeSnapshot)
  const encode = createSnapshotEncoder(create, fallback)
  const failed = encode(blankSnapshot())
  workers[0].onmessage!({ data: { id: 1, error: "Invalid string length" } } as MessageEvent)
  await expect(failed).rejects.toThrow("Invalid string length")
  const next = encode(blankSnapshot())
  workers[0].onmessage!({ data: { id: 2, bytes: new Uint8Array([1]) } } as MessageEvent)
  expect(await next).toEqual(new Uint8Array([1]))
  expect(create).toHaveBeenCalledOnce()
  expect(fallback).not.toHaveBeenCalled()
})
