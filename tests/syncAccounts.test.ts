import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { configure, setStorageFactory, unload } from "@lift/core/store/persist"
import { getState, markHydrated } from "@lift/core/store/store"
import { serialize, setSnapshotEncoder } from "@lift/core/store/blob"
import { configureSync, pushNow } from "@lift/core/sync"
import { applyRemoteBytes, forcePush, previewRemote, pullAndReplace } from "@lift/core/sync/autoSync"
import { CloudflareTransport } from "@lift/core"
import { memoryStorage } from "./helpers/store"
import { blankSnapshot } from "./helpers/build"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
let sequence = 0
function open(name: string) {
  configure(`${name}-${++sequence}`)
  const s = blankSnapshot()
  s.day_notes = [{ date: "2026-11-12", text: name }]
  markHydrated(s)
}
beforeEach(() => { setStorageFactory(() => memoryStorage()); open("A") })
afterEach(async () => { setSnapshotEncoder(null); configureSync(null); await unload(); vi.unstubAllGlobals() })

it.each([pullAndReplace, forcePush])("refuses a late download after switching accounts (%s)", async action => {
  const bytes = await serialize(getState().snapshot)
  const download = deferred<{ bytes: Uint8Array; etag: string }>()
  const push = vi.fn(async () => ({ etag: "new" }))
  configureSync({ pushSnapshot: push, pullSnapshot: () => download.promise })
  const pending = action()
  open("B")
  download.resolve({ bytes, etag: "A" })
  await expect(pending).rejects.toThrow("account changed")
  expect(getState().snapshot.day_notes[0].text).toBe("B")
  expect(push).not.toHaveBeenCalled()
})

it("refuses an old preview even after signing back into the same account", async () => {
  const bytes = await serialize(getState().snapshot)
  const transport = { pushSnapshot: async () => ({ etag: "a" }), pullSnapshot: async () => ({ bytes, etag: "a" }) }
  configureSync(transport)
  const preview = await previewRemote()
  await unload()
  open("A")
  await expect(applyRemoteBytes(preview!.bytes)).rejects.toThrow("account changed")
})

it("does not send an outgoing snapshot with the next account's transport after encoding", async () => {
  const encoded = deferred<Uint8Array>()
  setSnapshotEncoder(() => encoded.promise)
  const oldPush = vi.fn(async () => ({ etag: "a" }))
  const nextPush = vi.fn(async () => ({ etag: "b" }))
  configureSync({ pushSnapshot: oldPush, pullSnapshot: async () => null })
  const pending = pushNow(getState().snapshot)
  configureSync({ pushSnapshot: nextPush, pullSnapshot: async () => null })
  encoded.resolve(new Uint8Array([1]))
  await expect(pending).rejects.toThrow("account changed")
  expect(oldPush).not.toHaveBeenCalled()
  expect(nextPush).not.toHaveBeenCalled()
})

it("a closed transport cannot persist a late upload ETag", async () => {
  const response = deferred<Response>()
  vi.stubGlobal("fetch", vi.fn(() => response.promise))
  const changed = vi.fn()
  const transport = new CloudflareTransport({ apiBase: "https://example.test/api", getToken: () => "A", onEtagChange: changed })
  configureSync(transport)
  const pending = transport.pushSnapshot(new Uint8Array([1]))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  configureSync(null)
  response.resolve(Response.json({ etag: "A-late", quota: null }))
  await expect(pending).rejects.toThrow("closed")
  expect(changed).not.toHaveBeenCalled()
})
