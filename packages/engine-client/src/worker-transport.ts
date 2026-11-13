import type {EngineTransport, QueryReply, Receipt} from './index'

/** One dedicated worker per session. The window owns the existing global
 * browser lock for the entire lifetime, including close and accepted writes. */
export async function openWorkerTransport(worker: Worker, sessionId: string, accountKey: string, emptySnapshot?: unknown): Promise<{transport: EngineTransport; generation: number; revision: number}> {
  let sequence=0, closed=false
  const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
  const fail=(message:string)=>{
    closed=true
    for(const task of pending.values())task.reject(new Error(message))
    pending.clear()
    worker.terminate()
  }
  worker.addEventListener('error',event=>fail(event.message || 'Engine worker stopped.'))
  worker.addEventListener('messageerror',()=>fail('Engine worker response could not be decoded.'))
  worker.addEventListener('message',event=>{
    const message=event.data
    if(message.sessionId!==sessionId)return
    const task=pending.get(message.requestId)
    if(!task)return
    pending.delete(message.requestId)
    if(message.error)task.reject(new Error(message.error))
    else task.resolve(message.result)
  })
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
      close:async()=>{
        if(closed)return
        try{await send('close',{})}finally{fail('Engine worker closed.')}
      },
    }
    return {transport,generation:state.generation,revision:state.revision}
  }catch(error){fail('Engine worker startup failed.');throw error}
}
