import { BrowserStorage, TABLES, type WriteSet } from './browser-storage'

export interface WasmEngine {
  query(query: string): string
  prepare(commandId: string, command: string, now: string, today: string): string
  publish(commandId: string): string
  discard(commandId: string): void
  free(): void
}
export interface WasmFactory {
  new(snapshot: string, revision: number, generation: number, nextId: number): WasmEngine
}
export type WorkerOperation = 'open' | 'query' | 'execute' | 'replace_snapshot' | 'close'
export interface WorkerMessage {
  requestId: string; sessionId: string
  operation: WorkerOperation
  payload: Record<string, unknown>
}
const canonical=(value: unknown): string => {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
  return JSON.stringify(value)
}
const ID_TABLES = ['exercises', 'workouts', 'workout_exercises', 'sets', 'gyms'] as const

/** One past the largest row id, so an allocator never hands out an id a row
 * already uses. */
export function nextIdAbove(snapshot: Record<string, unknown>): number {
  let maxId = 0
  for (const table of ID_TABLES) {
    const rows = (snapshot[table] as Array<{id?: unknown}> | undefined) ?? []
    for (const row of rows) if (typeof row.id === 'number' && row.id > maxId) maxId = row.id
  }
  return maxId + 1
}

function isEmptyDataset(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const s = snapshot as Record<string, unknown>
  return TABLES.every(table => Array.isArray(s[table]) && (s[table] as unknown[]).length === 0)
}

/** Install inside a dedicated worker. The window host must already hold the
 * existing origin-wide lift:store-editor lock. `factory` may be a promise
 * (Wasm still initializing); messages queue until it resolves. */
export function installWorkerRuntime(scope: Pick<Worker, 'postMessage' | 'addEventListener'>, factory: WasmFactory | Promise<WasmFactory>) {
  let session: {id: string; generation: number; nextId: number; engine: WasmEngine; storage: BrowserStorage} | null = null
  let queue: Promise<void>=Promise.resolve()
  const ready = Promise.resolve(factory)
  scope.addEventListener('message',event=>{
    const request=(event as MessageEvent<WorkerMessage>).data
    queue=queue.then(async()=>{
      try {
        const Factory=await ready
        let result: unknown=null
        if(request.operation==='open') {
          if(session)throw new Error('Close the active session first.')
          const account=request.payload.accountKey
          if(typeof account!=='string'||!account)throw new Error('Invalid account key.')
          const storage=await BrowserStorage.open('lift-rust-engine:'+account)
          try {
            const loaded=await storage.load()
            const initial=request.payload.emptySnapshot as Record<string,unknown>|undefined
            if(!loaded&&!isEmptyDataset(initial))throw new Error('Legacy data requires verified migration before opening the Rust engine.')
            const snapshot=loaded?.snapshot??initial!
            const generation=loaded?.meta.generation??1
            const revision=loaded?.meta.revision??0
            const nextId=Math.max(loaded?.meta.next_id??1,nextIdAbove(snapshot))
            const engine=new Factory(JSON.stringify(snapshot),revision,generation,nextId)
            session={id:request.sessionId,generation,nextId,engine,storage}
            result={generation,revision}
          }catch(error){storage.close();throw error}
        }else{
          if(!session||session.id!==request.sessionId)throw new Error('Stale engine session.')
          if(request.operation==='query')result=JSON.parse(session.engine.query(JSON.stringify(request.payload.query)))
          else if(request.operation==='execute'){
            if(request.payload.generation!==session.generation)throw new Error('Stale dataset generation.')
            const id=request.payload.commandId
            if(typeof id!=='string'||!id)throw new Error('Invalid command ID.')
            const receipt=await session.storage.receipt(session.generation,id) as {payload: unknown}|undefined
            if(receipt){
              if(canonical(receipt.payload)!==canonical(request.payload.command))throw new Error('Command ID reused with different payload.')
              result=receipt
            }else{
              const prepared:WriteSet=JSON.parse(session.engine.prepare(id,JSON.stringify(request.payload.command),String(request.payload.now),String(request.payload.today)))
              try {await session.storage.commit(prepared)}
              catch(error){session.engine.discard(id);throw error}
              session.nextId=Math.max(session.nextId,prepared.next_id)
              // If publication fails after commit, discard this session rather
              // than accept further commands against an older memory revision.
              try{result=JSON.parse(session.engine.publish(id))}
              catch(error){session.engine.free();session.storage.close();session=null;throw error}
            }
          }else if(request.operation==='replace_snapshot'){
            const snap=request.payload.snapshot as Record<string,unknown>
            if(!snap||typeof snap!=='object')throw new Error('Invalid replacement snapshot.')
            const gen=request.payload.generation===undefined?session.generation+1:Number(request.payload.generation)
            if(gen!==session.generation+1)throw new Error('Stale dataset generation.')
            const rev=request.payload.revision===undefined?1:Number(request.payload.revision)
            if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Invalid replacement revision.')
            // The allocator only moves forward: ids of rows deleted before the
            // replacement are never handed out again.
            const nextId=Math.max(session.nextId,nextIdAbove(snap))
            // Validate first. A snapshot the engine refuses leaves storage and
            // the current engine as they were.
            const replacement=new Factory(JSON.stringify(snap),rev,gen,nextId)
            try{await session.storage.replaceSnapshot(snap,gen,rev,nextId)}
            catch(error){replacement.free();throw error}
            session.engine.free()
            session.engine=replacement
            session.generation=gen
            session.nextId=nextId
            result={generation:gen,revision:rev}
          }else if(request.operation==='close'){
            session.engine.free();session.storage.close();session=null
          }else{
            throw new Error('Unknown engine operation.')
          }
        }
        scope.postMessage({requestId:request.requestId,sessionId:request.sessionId,result})
      }catch(error){scope.postMessage({requestId:request.requestId,sessionId:request.sessionId,error:error instanceof Error?error.message:String(error)})}
    }).catch(()=>{})
  })
}
