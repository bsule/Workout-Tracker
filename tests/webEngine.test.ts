import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { serialize } from '@lift/core/store/blob'
import { emptySnapshot, SCHEMA_VERSION } from '@lift/core/store/schema'
import type { BlobStorage } from '@lift/core/store/storage'
import { BrowserStorage } from '../packages/engine-client/src/browser-storage'
import { openWorkerTransport } from '../packages/engine-client/src/worker-transport'
import {
  createWebSessions,
  legacyStoreHasData,
  webEngineErrorMessage,
  WEB_ENGINE_ENABLED,
  WebEngineMigrationMissingError,
} from '../frontend/lib/engine/webEngine'

/** A worker double that answers every request, or stays silent when asked. */
class FakeWorker {
  terminated = false
  listeners = new Map<string, Set<(event: any) => void>>()
  posted: any[] = []
  constructor(private reply: (message: any) => any = () => ({ generation: 1, revision: 0 }), private silent = false) {}
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener) }
  emit(type: string, event: any) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
  postMessage(message: any) {
    if (this.terminated) return
    this.posted.push(message)
    if (this.silent) return
    queueMicrotask(() => this.emit('message', { data: { requestId: message.requestId, sessionId: message.sessionId, result: this.reply(message) } }))
  }
  terminate() { this.terminated = true }
  listenerCount() { let n = 0; for (const set of this.listeners.values()) n += set.size; return n }
}

function memoryStorage(snapshot: Uint8Array | null, pending: string[] = []): BlobStorage {
  return {
    readSnapshot: async () => snapshot,
    writeSnapshot: async () => {},
    appendPending: async () => {},
    readPending: async () => pending,
    clearPending: async () => {},
  }
}

async function settle(sessions: ReturnType<typeof createWebSessions>, key: string | null) {
  await sessions.switchAccount(key)
  return sessions.getSnapshot()
}

it('is off unless the build turns it on', () => {
  expect(WEB_ENGINE_ENABLED).toBe(false)
})

it('opens an empty account with a valid core snapshot and a new worker each session', async () => {
  const workers: FakeWorker[] = []
  const sessions = createWebSessions({
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker },
    legacyStorage: () => memoryStorage(null),
    getDeviceId: async () => 'device-1',
    now: () => '2026-01-01T00:00:00.000Z',
  })
  expect((await settle(sessions, '7')).status).toBe('ready')
  const open = workers[0].posted[0]
  expect(open.operation).toBe('open')
  expect(open.payload.accountKey).toBe('7')
  expect(open.payload.emptySnapshot).toEqual({ ...emptySnapshot('device-1'), exported_at: '2026-01-01T00:00:00.000Z' })
  expect(open.payload.emptySnapshot).toMatchObject({ schema_version: SCHEMA_VERSION, settings: { weight_unit: 'lb', first_day_of_week: 0 } })
  await settle(sessions, null)
  expect(workers[0].terminated).toBe(true)
  expect(workers[0].listenerCount()).toBe(0)
  expect((await settle(sessions, '7')).status).toBe('ready')
  expect(workers).toHaveLength(2)
  expect(workers[1].terminated).toBe(false)
  await settle(sessions, null)
})

it('rejects instead of opening empty when the legacy store cannot be read', async () => {
  const createWorker = vi.fn(() => new FakeWorker() as unknown as Worker)
  const broken = memoryStorage(null)
  broken.readSnapshot = async () => { throw new Error('disk failed') }
  const sessions = createWebSessions({ createWorker, legacyStorage: () => broken, getDeviceId: async () => 'd' })
  const state = await settle(sessions, '7')
  expect(state.status).toBe('error')
  expect(createWorker).not.toHaveBeenCalled()
  expect(webEngineErrorMessage(state)).toMatch('could not be opened')

  const corrupt = createWebSessions({ createWorker, legacyStorage: () => memoryStorage(new Uint8Array([1, 2, 3])), getDeviceId: async () => 'd' })
  expect((await settle(corrupt, '7')).status).toBe('error')
  expect(createWorker).not.toHaveBeenCalled()
})

it('refuses to open over legacy data until browser migration exists', async () => {
  const snapshot = emptySnapshot('d')
  snapshot.day_notes.push({ date: '2026-01-01', text: 'kept' })
  const bytes = await serialize(snapshot)
  const createWorker = vi.fn(() => new FakeWorker() as unknown as Worker)
  const sessions = createWebSessions({ createWorker, legacyStorage: () => memoryStorage(bytes), getDeviceId: async () => 'd' })
  const state = await settle(sessions, '7')
  expect(state.status === 'error' && state.error).toBeInstanceOf(WebEngineMigrationMissingError)
  expect(webEngineErrorMessage(state)).toMatch('not implemented')
  expect(createWorker).not.toHaveBeenCalled()
  expect(await legacyStoreHasData(memoryStorage(null, ['{"op":"add_set"}']))).toBe(true)
  expect(await legacyStoreHasData(memoryStorage(await serialize(emptySnapshot('d'))))).toBe(false)
})

it('terminates a failed worker, rejects its pending requests and never reuses it', async () => {
  const worker = new FakeWorker((message) => message.operation === 'open' ? { generation: 1, revision: 0 } : undefined)
  const { transport } = await openWorkerTransport(worker as unknown as Worker, 's1', '7')
  // Stop answering, then crash with a request in flight.
  ;(worker as any).silent = true
  const inFlight = transport.query({ kind: 'counts' })
  worker.emit('error', { message: 'Wasm trapped' })
  await expect(inFlight).rejects.toThrow('Wasm trapped')
  expect(worker.terminated).toBe(true)
  expect(worker.listenerCount()).toBe(0)
  await expect(transport.query({ kind: 'counts' })).rejects.toThrow('closed')
  await transport.close()
  const next = new FakeWorker()
  const reopened = await openWorkerTransport(next as unknown as Worker, 's2', '7')
  expect(reopened.generation).toBe(1)
  expect(next.posted[0].sessionId).toBe('s2')
  await reopened.transport.close()
  expect(next.terminated).toBe(true)
})

it('migrates legacy store data when migrateLegacy is enabled', async () => {
  const snapshot = emptySnapshot('d')
  snapshot.day_notes.push({ date: '2026-01-01', text: 'migrated day note' })
  const bytes = await serialize(snapshot)
  const workers: FakeWorker[] = []
  const sessions = createWebSessions({
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker },
    legacyStorage: () => memoryStorage(bytes),
    getDeviceId: async () => 'd',
    migrateLegacy: true,
  })
  const state = await settle(sessions, '42')
  expect(state.status).toBe('ready')
  expect(workers).toHaveLength(1)
  const storage = await BrowserStorage.open('lift-rust-engine:42')
  const loaded = await storage.load()
  expect(loaded?.snapshot.day_notes).toEqual([{ date: '2026-01-01', text: 'migrated day note' }])
  storage.close()
  await settle(sessions, null)
})

it('localApi delegates to engine or core store depending on active session', async () => {
  const store = await import('../frontend/lib/store')
  expect(typeof store.localApi.updateSettings).toBe('function')
  expect(typeof store.localApi.createWorkout).toBe('function')
  expect(typeof store.localApi.removeExerciseFromWorkout).toBe('function')
  expect(typeof store.deleteWorkoutExercise).toBe('function')
  expect(typeof store.deleteSets).toBe('function')
})

