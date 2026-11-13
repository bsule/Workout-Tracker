import {EngineClient,type EngineTransport} from './index'
import {EngineDataApi,type DataTransport} from './data-api'
import {WorkoutApi} from './workout-api'
export interface OpenedEngine {
  transport: EngineTransport; generation:number; revision:number;data?:DataTransport
}
export interface AccountEngineSession {
  accountKey:string; client:EngineClient; api:WorkoutApi;data?:EngineDataApi
}
export type SessionState = {status:'closed'} | {status:'opening';accountKey:string} | {status:'ready';session:AccountEngineSession} | {status:'error';accountKey:string;error:Error}
/** One owner at a time. A late open never becomes visible after account change.
 * `context` travels with one switch (the username that locates a legacy store,
 * for example), so an open never reads another switch's values. */
export class AccountSessions<C = undefined> {
  private state:SessionState={status:'closed'}
  private listeners=new Set<()=>void>()
  private work:Promise<void>=Promise.resolve()
  private desired=0
  private current:AccountEngineSession|null=null
  /** Command IDs are `${session}:${n}` and receipts are durable, so a session
   * ID must never repeat across launches: a relaunch that reused `mobile:1`
   * would see its first command refused as a reused ID. */
  private readonly nonce=Date.now().toString(36)+Math.random().toString(36).slice(2,10)
  constructor(private open:(accountKey:string,sessionId:string,context:C)=>Promise<OpenedEngine>,private prefix:string){}
  getSnapshot=()=>this.state
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  /** The ready session, if any. */
  get session(){return this.state.status==='ready'?this.state.session:null}
  private publish(state:SessionState){this.state=state;for(const listener of this.listeners)listener()}
  switchAccount(accountKey:string|null,context?:C):Promise<void>{
    const ticket=++this.desired
    // Stop rendering outgoing query results immediately; storage teardown may
    // still be draining accepted writes in the serial queue.
    this.publish(accountKey?{status:'opening',accountKey}:{status:'closed'})
    const run=this.work.then(async()=>{
      if(this.current){const outgoing=this.current;this.current=null;await outgoing.client.close()}
      if(ticket!==this.desired||accountKey===null)return
      let opened:OpenedEngine
      try{opened=await this.open(accountKey,`${this.prefix}:${this.nonce}:${ticket}`,context as C)}
      catch(error){if(ticket===this.desired)this.publish({status:'error',accountKey,error:error instanceof Error?error:new Error(String(error))});return}
      if(ticket!==this.desired){await opened.transport.close();return}
      const client=new EngineClient(opened.transport,opened.generation,opened.revision)
      const id=`${this.prefix}:${this.nonce}:${ticket}`
      const session={accountKey,client,api:new WorkoutApi(client,id),data:opened.data?new EngineDataApi(client,opened.data,id):undefined}
      this.current=session;this.publish({status:'ready',session})
    })
    this.work=run.catch(error=>{if(ticket===this.desired&&accountKey)this.publish({status:'error',accountKey,error:error instanceof Error?error:new Error(String(error))})})
    return this.work
  }
}
