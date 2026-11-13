/** Session-scoped asynchronous boundary. React caches query results only. */
export interface QueryReply<T> { revision: number; generation: number; data: T }
export interface Receipt<T = unknown> {
  command_id: string
  generation: number
  revision: number
  result: T
}
export interface EngineTransport {
  query(query: unknown): Promise<QueryReply<unknown>>
  execute(commandId: string, generation: number, command: unknown, now: string, today: string): Promise<Receipt>
  replaceSnapshot?(snapshot: unknown, generation?: number, revision?: number): Promise<{generation: number; revision: number}>
  close(): Promise<void>
}
export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T; revision: number }
  | { status: 'error'; error: Error }
interface Entry {
  query: unknown
  state: QueryState<unknown>
  listeners: Set<() => void>
  request: number
  /** A commit may have changed this result since it was read. */
  stale: boolean
  /** A read is in flight. */
  reading: boolean
}
/** Unsubscribed results kept so a screen that opens again, or a covered
 * screen, shows its last data at once instead of a blank loading frame. */
const RETAINED_IDLE = 64
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error))
/** The engine serves history at most this many days per read. */
export const HISTORY_PAGE_DAYS = 100

/** Client-side query: an exercise's whole history, read page by page. Every
 * page must come from the same revision, or the read starts over. */
export interface HistoryAllQuery { kind: 'history_all'; exercise_id: number }
async function readQuery(transport: EngineTransport, query: unknown): Promise<QueryReply<unknown>> {
  const q = query as Partial<HistoryAllQuery> | null
  if (!q || q.kind !== 'history_all') return transport.query(query)
  for (let attempt = 0; attempt < 3; attempt++) {
    const items: unknown[] = []
    let first: QueryReply<unknown> | null = null
    let total = 0
    let consistent = true
    do {
      const page = await transport.query({ kind: 'history', exercise_id: q.exercise_id, offset: items.length, limit: HISTORY_PAGE_DAYS }) as QueryReply<{ total: number; items: unknown[] }>
      if (first && (page.revision !== first.revision || page.generation !== first.generation)) { consistent = false; break }
      first ??= page
      total = page.data.total
      items.push(...page.data.items)
      if (!page.data.items.length) break
    } while (items.length < total)
    if (consistent && first) return { generation: first.generation, revision: first.revision, data: { total, items } }
  }
  throw new Error('History changed while it was being read; try again.')
}

export function isQueryAffected(query: unknown, command?: unknown, replaced?: boolean): boolean {
  if (replaced || !command || typeof command !== 'object' || !('op' in (command as Record<string, unknown>))) {
    return true
  }
  if (!query || typeof query !== 'object' || !('kind' in (query as Record<string, unknown>))) {
    return true
  }
  const cmd = command as Record<string, unknown>
  const q = query as Record<string, unknown>
  const op = String(cmd.op)
  const kind = String(q.kind)

  switch (op) {
    case 'update_settings':
      return kind === 'settings' || kind === 'chart' || kind === 'summary'
    case 'set_day_note':
      if (kind === 'day_note') return !q.date || !cmd.date || q.date === cmd.date
      if (kind === 'workout_by_date') return !q.date || !cmd.date || q.date === cmd.date
      return kind === 'counts'
    case 'create_gym':
    case 'rename_gym':
    case 'delete_gym':
      return kind === 'gyms' || kind === 'workout' || kind === 'workout_by_date'
    case 'create_exercise':
    case 'patch_exercise':
    case 'delete_exercise':
      if (kind === 'exercise') return !q.id || !cmd.id || q.id === cmd.id
      // The calendar shows each day's categories, so an exercise's category
      // or deletion changes it. Planned dates can lose a deleted exercise.
      return kind === 'exercises' || kind === 'workout' || kind === 'workout_by_date' || kind === 'history' || kind === 'history_all' || kind === 'history_page' || kind === 'chart' || kind === 'summary' || kind === 'counts' || kind === 'calendar' || kind === 'planned_dates' || kind === 'ai_history'
    case 'set_exercise_note':
      return kind === 'workout' || kind === 'workout_by_date' || kind === 'history' || kind === 'history_all' || kind === 'history_page'
    default:
      if (kind === 'settings' || kind === 'gyms') return false
      if (kind === 'day_note') return op === 'delete_workout'
      return true
  }
}

export class EngineClient {
  private closed = false
  private closing: Promise<void> | null = null
  private entries = new Map<string, Entry>()
  private revision = 0
  private writes: Promise<void> = Promise.resolve()
  private currentGeneration: number
  constructor(private transport: EngineTransport, generation: number, revision = 0) {
    this.currentGeneration = generation
    this.revision = revision
  }
  get generation() { return this.currentGeneration }
  get version() { return { generation: this.generation, revision: this.revision } }
  private idle = new Set<string>()
  private invalidate(replaced: boolean, command?: unknown) {
    for (const [key, entry] of this.entries) {
      if (!isQueryAffected(entry.query, command, replaced)) {
        continue
      }
      entry.request++
      entry.stale = true
      if (replaced) {
        // Another dataset: never show the outgoing one's rows.
        entry.state = { status: 'loading' }
        for (const listener of entry.listeners) listener()
      }
      if (entry.listeners.size) void this.refresh(key, entry)
    }
  }

  private markIdle(key: string) {
    this.idle.delete(key)
    this.idle.add(key)
    while (this.idle.size > RETAINED_IDLE) {
      const oldest = this.idle.values().next().value as string
      this.idle.delete(oldest)
      const entry = this.entries.get(oldest)
      if (entry && !entry.listeners.size) {
        entry.request++
        this.entries.delete(oldest)
      }
    }
  }

  private entry(key: string, query: unknown) {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { query, state: { status: 'loading' }, listeners: new Set(), request: 0, stale: true, reading: false }
      this.entries.set(key, entry)
      this.markIdle(key)
    }
    return entry
  }
  snapshot<T>(key: string, query: unknown): QueryState<T> {
    return this.entry(key, query).state as QueryState<T>
  }
  subscribe(key: string, query: unknown, listener: () => void): () => void {
    if (this.closed) return () => {}
    const entry = this.entry(key, query)
    entry.listeners.add(listener)
    this.idle.delete(key)
    // Read on subscribe unless the kept result is still current, so a
    // commit between the first render and this subscription is not missed.
    if (entry.stale || entry.state.status !== 'ready') void this.refresh(key, entry)
    return () => {
      entry.listeners.delete(listener)
      if (!entry.listeners.size && this.entries.get(key) === entry) {
        if (entry.reading) {
          // Drop the in-flight read; the kept value may now be behind.
          entry.request++
          entry.reading = false
          entry.stale = true
        }
        this.markIdle(key)
      }
    }
  }
  /** Bring one result up to date without subscribing (a covered screen about
   * to be revealed, or a value a handler needs next). */
  prefetch(key: string, query: unknown): Promise<void> {
    if (this.closed) return Promise.resolve()
    const entry = this.entry(key, query)
    if (!entry.stale && entry.state.status === 'ready') return Promise.resolve()
    return this.refresh(key, entry)
  }
  private async refresh(key: string, entry: Entry, staleRetries = 0): Promise<void> {
    if (this.closed) return
    const request = ++entry.request
    entry.reading = true
    try {
      const reply = await readQuery(this.transport, entry.query)
      if (this.closed || request !== entry.request || this.entries.get(key) !== entry) return
      entry.reading = false
      if (reply.generation !== this.generation) throw new Error('Dataset changed; reopen the engine session.')
      if (reply.revision < this.revision) {
        if (staleRetries >= 2) throw new Error("Engine returned a stale query revision.")
        return this.refresh(key, entry, staleRetries + 1)
      }
      entry.stale = false
      if (entry.state.status === 'ready' && reply.revision < entry.state.revision) return
      entry.state = { status: 'ready', value: reply.data, revision: reply.revision }
    } catch (error) {
      if (this.closed || request !== entry.request || this.entries.get(key) !== entry) return
      entry.reading = false
      entry.state = { status: 'error', error: asError(error) }
    }
    for (const listener of entry.listeners) listener()
  }
  async query<T>(query: unknown): Promise<T> {
    if(this.closed)throw new Error('Engine session closed.')
    await this.writes
    if(this.closed)throw new Error('Engine session closed during query.')
    const result=await readQuery(this.transport,query)
    if(this.closed)throw new Error('Engine session closed during query.')
    if(result.generation!==this.generation)throw new Error('Dataset changed; reopen session.')
    if(result.revision<this.revision)throw new Error('Stale query result; retry.')
    return result.data as T
  }
  execute<T>(commandId: string, command: unknown, now: string, today: string): Promise<Receipt<T>> {
    if (this.closed) return Promise.reject(new Error('Engine session closed.'))
    return this.commit(() => this.transport.execute(commandId, this.generation, command, now, today) as Promise<Receipt<T>>, command)
  }
  /** Imports/restores share the mutation queue with ordinary edits. The effect
   * receives the version when it starts, after previously accepted edits drain.
   * Replacement receipts advance the generation and invalidate old views. */
  commit<T>(effect: (version: {generation:number; revision:number}) => Promise<Receipt<T>>, command?: unknown): Promise<Receipt<T>> {
    if (this.closed) return Promise.reject(new Error('Engine session closed.'))
    const run = this.writes.then(async () => {
      const base = this.version
      const reply = await effect(base)
      if (this.closed) throw new Error('Engine session closed during command.')
      if (!Number.isSafeInteger(reply.generation) || !Number.isSafeInteger(reply.revision) ||
          reply.generation < base.generation || reply.generation > base.generation + 1 || reply.revision < 0) {
        throw new Error('Invalid engine commit version.')
      }
      const replaced = reply.generation !== base.generation
      // Deduplicated old command receipts can carry an earlier revision.
      if (replaced && reply.revision <= base.revision) throw new Error('Invalid replacement revision.')
      this.currentGeneration = reply.generation
      this.revision = Math.max(this.revision, reply.revision)
      this.invalidate(replaced, command)
      return reply
    })
    this.writes = run.then(() => {}, () => {})
    return run
  }
  /** Atomically replace the entire snapshot dataset with a new snapshot */
  replaceSnapshot(snapshot: unknown): Promise<{generation: number; revision: number}> {
    if (this.closed) return Promise.reject(new Error('Engine session closed.'))
    if (!this.transport.replaceSnapshot) return Promise.reject(new Error('Transport does not support replaceSnapshot.'))
    const run = this.writes.then(async () => {
      const base = this.version
      const reply = await this.transport.replaceSnapshot!(snapshot, base.generation + 1, 1)
      this.currentGeneration = reply.generation
      this.revision = reply.revision
      this.invalidate(true)
      return reply
    })
    this.writes = run.then(() => {}, () => {})
    return run
  }
  /** Serialize storage effects with commands, without treating a read or sync
   * acknowledgement as a new data revision. Never hold this across HTTP. */
  effect<T>(effect: (version: {generation:number; revision:number}) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Engine session closed.'))
    const run = this.writes.then(() => effect(this.version))
    this.writes = run.then(() => {}, () => {})
    return run.then(result => {
      if (this.closed) throw new Error('Engine session closed during effect.')
      return result
    })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    for (const entry of this.entries.values()) entry.request++
    this.entries.clear()
    this.idle.clear()
    this.closing = this.writes.then(() => this.transport.close())
    return this.closing
  }
}
