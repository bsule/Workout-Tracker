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
/** One owner at a time. A late open never becomes visible after account change. */
export class AccountSessions {
  private state:SessionState={status:'closed'}
  private listeners=new Set<()=>void>()
  private work:Promise<void>=Promise.resolve()
  private desired=0
  private current:AccountEngineSession|null=null
  constructor(private open:(accountKey:string,sessionId:string)=>Promise<OpenedEngine>,private prefix:string){}
  getSnapshot=()=>this.state
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private publish(state:SessionState){this.state=state;for(const listener of this.listeners)listener()}
  switchAccount(accountKey:string|null):Promise<void>{
    const ticket=++this.desired
    // Stop rendering outgoing query results immediately; storage teardown may
    // still be draining accepted writes in the serial queue.
    this.publish(accountKey?{status:'opening',accountKey}:{status:'closed'})
    const run=this.work.then(async()=>{
      if(this.current){await this.current.client.close();this.current=null}
      if(ticket!==this.desired||accountKey===null)return
      let opened:OpenedEngine
      try{opened=await this.open(accountKey,`${this.prefix}:${ticket}`)}
      catch(error){if(ticket===this.desired)this.publish({status:'error',accountKey,error:error instanceof Error?error:new Error(String(error))});return}
      if(ticket!==this.desired){await opened.transport.close();return}
      const client=new EngineClient(opened.transport,opened.generation,opened.revision)
      const session={accountKey,client,api:new WorkoutApi(client,`${this.prefix}:${ticket}`),data:opened.data?new EngineDataApi(client,opened.data,`${this.prefix}:${ticket}`):undefined}
      this.current=session;this.publish({status:'ready',session})
    })
    this.work=run.catch(error=>{if(ticket===this.desired&&accountKey)this.publish({status:'error',accountKey,error:error instanceof Error?error:new Error(String(error))})})
    return this.work
  }
}
