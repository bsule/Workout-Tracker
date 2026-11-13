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
}
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error))

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
  private invalidate(replaced: boolean) {
    for (const [key, entry] of this.entries) {
      entry.request++
      if (replaced) {
        entry.state = { status: 'loading' }
        for (const listener of entry.listeners) listener()
      }
      if (entry.listeners.size) void this.refresh(key, entry)
    }
  }

  private entry(key: string, query: unknown) {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { query, state: { status: 'loading' }, listeners: new Set(), request: 0 }
      this.entries.set(key, entry)
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
    // Subscribe before the first read so a commit cannot be missed.
    void this.refresh(key, entry)
    return () => {
      entry.listeners.delete(listener)
      // Retain no unbounded history pages after a screen unmounts.
      if (!entry.listeners.size) {
        entry.request++
        this.entries.delete(key)
      }
    }
  }
  private async refresh(key: string, entry: Entry, staleRetries = 0) {
    if (this.closed) return
    const request = ++entry.request
    try {
      const reply = await this.transport.query(entry.query)
      if (this.closed || request !== entry.request || this.entries.get(key) !== entry) return
      if (reply.generation !== this.generation) throw new Error('Dataset changed; reopen the engine session.')
      if (reply.revision < this.revision) {
        if (staleRetries >= 2) throw new Error("Engine returned a stale query revision.")
        void this.refresh(key, entry, staleRetries + 1)
        return
      }
      if (entry.state.status === 'ready' && reply.revision < entry.state.revision) return
      entry.state = { status: 'ready', value: reply.data, revision: reply.revision }
    } catch (error) {
      if (this.closed || request !== entry.request || this.entries.get(key) !== entry) return
      entry.state = { status: 'error', error: asError(error) }
    }
    for (const listener of entry.listeners) listener()
  }
  async query<T>(query: unknown): Promise<T> {
    if(this.closed)throw new Error('Engine session closed.')
    await this.writes
    if(this.closed)throw new Error('Engine session closed during query.')
    const result=await this.transport.query(query)
    if(this.closed)throw new Error('Engine session closed during query.')
    if(result.generation!==this.generation)throw new Error('Dataset changed; reopen session.')
    if(result.revision<this.revision)throw new Error('Stale query result; retry.')
    return result.data as T
  }
  execute<T>(commandId: string, command: unknown, now: string, today: string): Promise<Receipt<T>> {
    if (this.closed) return Promise.reject(new Error('Engine session closed.'))
    return this.commit(() => this.transport.execute(commandId, this.generation, command, now, today) as Promise<Receipt<T>>)
  }
  /** Imports/restores share the mutation queue with ordinary edits. The effect
   * receives the version when it starts, after previously accepted edits drain.
   * Replacement receipts advance the generation and invalidate old views. */
  commit<T>(effect: (version: {generation:number; revision:number}) => Promise<Receipt<T>>): Promise<Receipt<T>> {
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
      this.invalidate(replaced)
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
    this.closing = this.writes.then(() => this.transport.close())
    return this.closing
  }
}
