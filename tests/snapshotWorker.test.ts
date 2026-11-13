import { Worker as NodeWorker } from "node:worker_threads"
import { build } from "esbuild"
import { afterEach, expect, it, vi } from "vitest"
import { createSnapshotEncoder } from "../frontend/lib/store/snapshotWorker"
import { parse, serialize, setSnapshotEncoder } from "@lift/core/store/blob"
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
  setSnapshotEncoder(createSnapshotEncoder(() => adapter as unknown as Worker))
  try {
    const snapshot = blankSnapshot()
    snapshot.exported_at = "2000-01-01T00:00:00.000Z"
    snapshot.workouts = [workout(1, "2026-11-12")]
    const restored = (await parse(await serialize(snapshot))).snapshot
    expect(restored.workouts).toEqual(snapshot.workouts)
    expect(restored.exported_at).not.toBe(snapshot.exported_at)
  } finally { await worker.terminate() }
})

it("rejects concurrent requests on a crash and starts a fresh worker for retry", async () => {
  const workers: Worker[] = []
  const create = vi.fn(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null } as unknown as Worker
    workers.push(worker)
    return worker
  })
  const encode = createSnapshotEncoder(create)
  const first = encode(blankSnapshot())
  const second = encode(blankSnapshot())
  const checked = Promise.all([expect(first).rejects.toThrow("stopped"), expect(second).rejects.toThrow("stopped")])
  workers[0].onerror!({} as ErrorEvent)
  await checked
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  const retry = encode(blankSnapshot())
  workers[1].onmessage!({ data: { id: 3, bytes: new Uint8Array([1]) } } as MessageEvent)
  expect(await retry).toEqual(new Uint8Array([1]))
  expect(create).toHaveBeenCalledTimes(2)
})
