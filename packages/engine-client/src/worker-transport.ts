import type {EngineTransport, QueryReply, Receipt} from './index'

/** One dedicated worker per session. The window owns the existing global
 * browser lock for the entire lifetime, including close and accepted writes.
 * Closing or a worker failure terminates the worker: pass a new Worker to the
 * next open, never the old one. */
export async function openWorkerTransport(worker: Worker, sessionId: string, accountKey: string, emptySnapshot?: unknown): Promise<{transport: EngineTransport; generation: number; revision: number}> {
  let sequence=0, closed=false
  const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
  const onError=(event: Event)=>fail((event as ErrorEvent).message || 'Engine worker stopped.')
  const onMessageError=()=>fail('Engine worker response could not be decoded.')
  const onMessage=(event: MessageEvent)=>{
    const message=event.data
    if(!message||message.sessionId!==sessionId)return
    const task=pending.get(message.requestId)
    if(!task)return
    pending.delete(message.requestId)
    if(message.error)task.reject(new Error(message.error))
    else task.resolve(message.result)
  }
  function fail(message:string){
    if(closed)return
    closed=true
    worker.removeEventListener('error',onError)
    worker.removeEventListener('messageerror',onMessageError)
    worker.removeEventListener('message',onMessage)
    for(const task of pending.values())task.reject(new Error(message))
    pending.clear()
    worker.terminate()
  }
  worker.addEventListener('error',onError)
  worker.addEventListener('messageerror',onMessageError)
  worker.addEventListener('message',onMessage)
  const send=(operation:string,payload:unknown):Promise<any>=>{
    if(closed)return Promise.reject(new Error('Engine worker closed.'))
    const requestId=String(++sequence)
    return new Promise((resolve,reject)=>{
      pending.set(requestId,{resolve,reject})
      try{worker.postMessage({requestId,sessionId,operation,payload})}
      catch(error){pending.delete(requestId);reject(error)}
    })
  }
  try{
    const state=await send('open',{accountKey,emptySnapshot})
    const transport:EngineTransport={
      query:(query):Promise<QueryReply<unknown>>=>send('query',{query}),
      execute:(commandId,generation,command,now,today):Promise<Receipt>=>send('execute',{commandId,generation,command,now,today}),
      replaceSnapshot:(snapshot,generation,revision)=>send('replace_snapshot',{snapshot,generation,revision}),
      close:async()=>{
        if(closed)return
        try{await send('close',{})}finally{fail('Engine worker closed.')}
      },
    }
    return {transport,generation:state.generation,revision:state.revision}
  }catch(error){fail('Engine worker startup failed.');throw error}
}
