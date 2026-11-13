import { requireOptionalNativeModule } from 'expo-modules-core'
import type { EngineTransport, QueryReply, Receipt } from '../../../packages/engine-client/src/index'

interface EngineInfo { protocolVersion: number; engineVersion: string }
interface NativeModule {
  info(): Promise<EngineInfo>
  open(session: string, path: string, deviceId: string, now: string): Promise<string>
  execute(session: string, commandId: string, generation: number, command: string, now: string, today: string): Promise<string>
  query(session: string, query: string): Promise<string>
  close(session: string): Promise<void>
}
const native=requireOptionalNativeModule<NativeModule>('LiftEngine')
function encode(value:unknown):string {
  return JSON.stringify(value,(_key,value)=>{
    if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid non-finite engine input.')
    return value
  })
}
export async function openNativeTransport(session:string,path:string,deviceId:string,now:string):Promise<{transport:EngineTransport;generation:number;revision:number}> {
  if(!native)throw new Error('Rust engine requires a development build with lift-engine included.')
  const info=await native.info()
  if(info.protocolVersion!==1)throw new Error('Unsupported Rust engine protocol. Rebuild the app.')
  const opened:QueryReply<unknown>=JSON.parse(await native.open(session,path,deviceId,now))
  const transport:EngineTransport={
    query:async(query)=>JSON.parse(await native.query(session,encode(query))),
    execute:async(id,generation,command,now,today):Promise<Receipt>=>JSON.parse(await native.execute(session,id,generation,encode(command),now,today)),
    close:()=>native.close(session),
  }
  return {transport,generation:opened.generation,revision:opened.revision}
}
