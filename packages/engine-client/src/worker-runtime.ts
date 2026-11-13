import { BrowserStorage, type WriteSet } from './browser-storage'

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
export interface WorkerMessage {
  requestId: string; sessionId: string
  operation: 'open' | 'query' | 'execute' | 'close'
  payload: Record<string, unknown>
}
const canonical=(value: unknown): string => {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
  return JSON.stringify(value)
}

/** Install inside a dedicated worker after Wasm initialization. The window
 * host must already hold the existing origin-wide lift:store-editor lock. */
export function installWorkerRuntime(scope: Pick<Worker, 'postMessage' | 'addEventListener'>, Factory: WasmFactory) {
  let session: {id: string; generation: number; engine: WasmEngine; storage: BrowserStorage} | null = null
  let queue: Promise<void>=Promise.resolve()
  scope.addEventListener('message',event=>{
    const request=(event as MessageEvent<WorkerMessage>).data
    queue=queue.then(async()=>{
      try {
        let result: unknown=null
        if(request.operation==='open') {
          if(session)throw new Error('Close the active session first.')
          const account=request.payload.accountKey
          if(typeof account!=='string'||!account)throw new Error('Invalid account key.')
          const storage=await BrowserStorage.open('lift-rust-engine:'+account)
          try {
            const loaded=await storage.load()
            const initial=request.payload.emptySnapshot as Record<string,unknown>
            if(!loaded&&(!initial||['workouts','sets','workout_exercises','exercises','gyms','day_notes'].some(key=>!Array.isArray(initial[key])||(initial[key] as unknown[]).length>0)))throw new Error('Legacy data requires verified migration before opening the Rust engine.')
            const snapshot=loaded?.snapshot??initial
            const generation=loaded?.meta.generation??1
            const engine=new Factory(JSON.stringify(snapshot),loaded?.meta.revision??0,generation,loaded?.meta.next_id??1)
            session={id:request.sessionId,generation,engine,storage}
            result={generation,revision:loaded?.meta.revision??0}
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
              // If publication fails after commit, discard this session rather
              // than accept further commands against an older memory revision.
              try{result=JSON.parse(session.engine.publish(id))}
              catch(error){session.engine.free();session.storage.close();session=null;throw error}
            }
          }else if(request.operation==='close'){
            session.engine.free();session.storage.close();session=null
          }
        }
        scope.postMessage({requestId:request.requestId,sessionId:request.sessionId,result})
      }catch(error){scope.postMessage({requestId:request.requestId,sessionId:request.sessionId,error:error instanceof Error?error.message:String(error)})}
    }).catch(()=>{})
  })
}
