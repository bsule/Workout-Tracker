import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { installWorkerRuntime, nextIdAbove, type WasmEngine, type WorkerMessage } from '../packages/engine-client/src/worker-runtime'
import { BrowserStorage } from '../packages/engine-client/src/browser-storage'

// A stand-in for the Wasm BrowserEngine: day notes only, enough to drive the
// prepare/commit/publish protocol the shipped worker runs.
class FakeEngine implements WasmEngine {
  static created: FakeEngine[] = []
  freed = false
  snapshot: any
  private pending: any = null
  constructor(json: string, public revision: number, public generation: number, public nextId: number) {
    const snapshot = JSON.parse(json)
    if (snapshot.invalid) throw new Error('Invalid snapshot')
    this.snapshot = snapshot
    FakeEngine.created.push(this)
  }
  query() {
    return JSON.stringify({ generation: this.generation, revision: this.revision, data: { notes: this.snapshot.day_notes, nextId: this.nextId } })
  }
  prepare(id: string, json: string) {
    const command = JSON.parse(json)
    const note = { date: command.date, text: command.text }
    const receipt = { command_id: id, generation: this.generation, revision: this.revision + 1, result: null, payload: command }
    this.pending = { note, receipt }
    return JSON.stringify({
      base_revision: this.revision, base_generation: this.generation, revision: this.revision + 1, generation: this.generation,
      next_id: this.nextId + 1, header: { schema_version: 9 },
      rows: [{ table: 'day_notes', key: command.date, value: note, ordinal: this.snapshot.day_notes.length }], receipt,
    })
  }
  publish() {
    this.snapshot.day_notes.push(this.pending.note)
    this.revision++
    this.nextId++
    return JSON.stringify(this.pending.receipt)
  }
  discard() { this.pending = null }
  free() { this.freed = true }
}

const empty = () => ({ schema_version: 9, exported_at: 'now', device_id: 'd', settings: {}, exercises: [], workouts: [], workout_exercises: [], sets: [], gyms: [], day_notes: [] })

function runtime() {
  const listeners: ((event: MessageEvent) => void)[] = []
  const waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let sequence = 0
  installWorkerRuntime({
    addEventListener: ((_: string, listener: any) => listeners.push(listener)) as any,
    postMessage: ((message: any) => {
      const task = waiting.get(message.requestId)!
      waiting.delete(message.requestId)
      if (message.error) task.reject(new Error(message.error))
      else task.resolve(message.result)
    }) as any,
  }, Promise.resolve(FakeEngine))
  return (sessionId: string, operation: WorkerMessage['operation'], payload: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const requestId = String(++sequence)
      waiting.set(requestId, { resolve, reject })
      for (const listener of listeners) listener({ data: { requestId, sessionId, operation, payload } } as MessageEvent)
    })
}

let account = ''
beforeEach(() => { account = crypto.randomUUID(); FakeEngine.created = [] })

it('opens an empty account, commits commands and replays a retried command id', async () => {
  const send = runtime()
  expect(await send('s', 'open', { accountKey: account, emptySnapshot: empty() })).toEqual({ generation: 1, revision: 0 })
  const command = { op: 'set_day_note', date: '2026-01-01', text: 'saved' }
  const first = await send('s', 'execute', { commandId: 'c1', generation: 1, command, now: 'now', today: '2026-01-01' })
  const retry = await send('s', 'execute', { commandId: 'c1', generation: 1, command, now: 'now', today: '2026-01-01' })
  expect(retry).toEqual(first)
  await expect(send('s', 'execute', { commandId: 'c1', generation: 1, command: { ...command, text: 'other' }, now: 'now', today: '2026-01-01' })).rejects.toThrow('reused')
  expect((await send('s', 'query', { query: {} })).data.notes).toEqual([{ date: '2026-01-01', text: 'saved' }])
  await expect(send('other', 'query', { query: {} })).rejects.toThrow('Stale engine session')
  await send('s', 'close')
  const reopened = runtime()
  expect(await reopened('t', 'open', { accountKey: account, emptySnapshot: empty() })).toEqual({ generation: 1, revision: 1 })
})

it('refuses to start a fresh database from a snapshot that has rows', async () => {
  const send = runtime()
  await expect(send('s', 'open', { accountKey: account, emptySnapshot: { ...empty(), day_notes: [{ date: '2026-01-01', text: 'x' }] } })).rejects.toThrow('verified migration')
  await expect(send('s', 'open', { accountKey: account })).rejects.toThrow('verified migration')
})

it('validates a replacement before writing it and keeps the old data on failure', async () => {
  const send = runtime()
  await send('s', 'open', { accountKey: account, emptySnapshot: empty() })
  await send('s', 'execute', { commandId: 'c1', generation: 1, command: { op: 'set_day_note', date: '2026-01-01', text: 'kept' }, now: 'now', today: 'today' })
  const before = FakeEngine.created[0]
  await expect(send('s', 'replace_snapshot', { snapshot: { ...empty(), invalid: true }, generation: 2, revision: 1 })).rejects.toThrow('Invalid snapshot')
  expect(before.freed).toBe(false)
  expect((await send('s', 'query', { query: {} })).data.notes).toEqual([{ date: '2026-01-01', text: 'kept' }])
  const db = await BrowserStorage.open('lift-rust-engine:' + account)
  expect((await db.load())?.snapshot.day_notes).toEqual([{ date: '2026-01-01', text: 'kept' }])
  db.close()
})

it('rejects a stale replacement generation and keeps the id allocator moving forward', async () => {
  const send = runtime()
  await send('s', 'open', { accountKey: account, emptySnapshot: empty() })
  for (let i = 0; i < 9; i++) {
    await send('s', 'execute', { commandId: 'c' + i, generation: 1, command: { op: 'set_day_note', date: `2026-01-0${i + 1}`, text: 'n' }, now: 'now', today: 'today' })
  }
  await expect(send('s', 'replace_snapshot', { snapshot: empty(), generation: 3, revision: 1 })).rejects.toThrow('Stale dataset generation')
  const small = { ...empty(), gyms: [{ id: 3, name: 'Home' }], day_notes: [{ date: '2026-02-01', text: 'b' }, { date: '2026-02-02', text: 'a' }] }
  expect(await send('s', 'replace_snapshot', { snapshot: small, generation: 2, revision: 1 })).toEqual({ generation: 2, revision: 1 })
  expect(FakeEngine.created.at(-1)!.nextId).toBe(10)
  expect(FakeEngine.created[0].freed).toBe(true)
  const db = await BrowserStorage.open('lift-rust-engine:' + account)
  const loaded = await db.load()
  expect(loaded?.meta).toMatchObject({ generation: 2, revision: 1, next_id: 10 })
  expect(loaded?.snapshot.day_notes).toEqual(small.day_notes)
  // Receipts of the replaced generation are dropped with it.
  expect(await db.receipt(1, 'c0')).toBeUndefined()
  db.close()
  const big = { ...empty(), gyms: [{ id: 20, name: 'Gym' }] }
  await send('s', 'replace_snapshot', { snapshot: big, generation: 3, revision: 1 })
  expect(FakeEngine.created.at(-1)!.nextId).toBe(21)
  await expect(send('s', 'execute', { commandId: 'late', generation: 1, command: {}, now: 'now', today: 'today' })).rejects.toThrow('Stale dataset generation')
})

it('computes the next id above every id table', () => {
  expect(nextIdAbove(empty())).toBe(1)
  expect(nextIdAbove({ ...empty(), sets: [{ id: 7 }], exercises: [{ id: 2 }] })).toBe(8)
})
