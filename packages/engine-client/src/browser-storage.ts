/** Browser-worker storage adapter for the Rust prepare/persist/publish protocol. */
export interface WriteSet {
  base_revision: number; base_generation: number; revision: number; generation: number; next_id: number
  header: Record<string, unknown>
  rows: {table: string; key: string; value: unknown | null; ordinal: number}[]
  receipt: {command_id: string; generation: number; [key: string]: unknown}
}
export interface StoredMeta {
  header: Record<string, unknown>; revision: number; generation: number; next_id: number
}
export const TABLES = ['exercises', 'workouts', 'workout_exercises', 'sets', 'gyms', 'day_notes'] as const
export class BrowserStorage {
  private constructor(private db: IDBDatabase) {}
  static open(name: string): Promise<BrowserStorage> {
    return new Promise((resolve,reject)=>{
      let rejected=false
      const request=indexedDB.open(name,1)
      request.onupgradeneeded=()=>{
        const db=request.result
        db.createObjectStore('meta')
        db.createObjectStore('records',{keyPath:['table','key']})
        db.createObjectStore('receipts',{keyPath:['generation','command_id']})
      }
      request.onerror=()=>reject(request.error)
      request.onblocked=()=>{rejected=true;reject(new Error('Browser database upgrade blocked by another tab.'))}
      request.onsuccess=()=>{
        const db=request.result
        if(rejected){db.close();return}
        db.onversionchange=()=>db.close()
        resolve(new BrowserStorage(db))
      }
    })
  }
  async load(): Promise<{meta: StoredMeta; snapshot: Record<string, unknown>} | null> {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['meta','records'],'readonly')
      const meta=tx.objectStore('meta').get('state')
      const records=tx.objectStore('records').getAll()
      tx.onabort=()=>reject(tx.error ?? new Error('Load aborted.'))
      tx.onerror=()=>{} // onabort supplies the transaction outcome
      tx.oncomplete=()=>{
        if(!meta.result){resolve(null);return}
        const snapshot={...meta.result.header} as Record<string,unknown>
        for(const table of TABLES) snapshot[table]=[]
        const rows=records.result.sort((a,b)=>a.ordinal-b.ordinal)
        for(const row of rows) {
          if(!Array.isArray(snapshot[row.table])){reject(new Error('Unknown stored table.'));return}
          ;(snapshot[row.table] as unknown[]).push(row.value)
        }
        resolve({meta:meta.result,snapshot})
      }
    })
  }
  receipt(generation: number, commandId: string): Promise<unknown | undefined> {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('receipts','readonly')
      const request=tx.objectStore('receipts').get([generation,commandId])
      tx.oncomplete=()=>resolve(request.result)
      tx.onabort=()=>reject(tx.error ?? new Error('Receipt read aborted.'))
    })
  }
  commit(writes: WriteSet): Promise<void> {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['meta','records','receipts'],'readwrite')
      let reason: Error | undefined
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(reason ?? tx.error ?? new Error('Commit aborted.'))
      const meta=tx.objectStore('meta')
      const current=meta.get('state')
      current.onsuccess=()=>{
        const revision=current.result?.revision ?? 0
        const generation=current.result?.generation ?? writes.base_generation
        if(revision!==writes.base_revision||generation!==writes.base_generation){reason=new Error('Concurrent writer; reopen required.');tx.abort();return}
        const records=tx.objectStore('records')
        for(const row of writes.rows) {
          if(row.value===null) records.delete([row.table,row.key])
          else records.put(row)
        }
        meta.put({header:writes.header,revision:writes.revision,generation:writes.generation,next_id:writes.next_id},'state')
        tx.objectStore('receipts').add(writes.receipt)
      }
    })
  }
  /** Install a whole dataset as a new generation in one transaction. Row
   * keys and ordinals follow the Rust WriteSet: id tables are keyed by id,
   * day_notes by date, and ordinal is the row's index within its own table,
   * so later per-row commits keep the same order on reload. Receipts of older
   * generations are dropped: the worker refuses commands for them anyway. */
  replaceSnapshot(snapshot: Record<string, unknown>, generation: number, revision: number, next_id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['meta', 'records', 'receipts'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Replace snapshot aborted.'))
      const meta = tx.objectStore('meta')
      const records = tx.objectStore('records')
      records.clear()
      tx.objectStore('receipts').delete(IDBKeyRange.upperBound([generation], true))
      const header: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(snapshot)) {
        if (!(TABLES as readonly string[]).includes(k)) header[k] = v
      }
      for (const table of TABLES) {
        const rows = (snapshot[table] as Array<Record<string, unknown>>) || []
        rows.forEach((row, ordinal) => {
          const key = table === 'day_notes' ? String(row.date) : String(row.id)
          records.put({ table, key, ordinal, value: row })
        })
      }
      meta.put({ header, revision, generation, next_id }, 'state')
    })
  }
  close(){this.db.close()}
}
