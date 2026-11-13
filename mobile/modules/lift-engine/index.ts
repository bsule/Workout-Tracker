import { requireOptionalNativeModule } from 'expo-modules-core'
import type { EngineTransport, QueryReply, Receipt } from '../../../packages/engine-client/src/index'

export interface ImportRequest {
  command_id: string; generation: number; revision: number
  format: 'json' | 'csv'; text: string; replace: boolean; now: string; today: string
}
export interface NativeDataApi {
  importFile(request: ImportRequest): Promise<Receipt>
  snapshotBytes(now: string): Promise<Uint8Array>
  backupBytes(slot: string): Promise<Uint8Array | null>
  saveRestorePoint(now: string): Promise<void>
  restorePoints(): Promise<Record<string, unknown>>
  syncState(): Promise<Record<string, unknown>>
}
interface EngineInfo { protocolVersion: number; engineVersion: string }
interface NativeModule {
  info(): Promise<EngineInfo>
  importFile(session: string, request: string): Promise<string>
  snapshotBytes(session: string, now: string): Promise<Uint8Array>
  backupBytes(session: string, slot: string): Promise<Uint8Array | null>
  saveRestorePoint(session: string, now: string): Promise<void>
  restorePoints(session: string): Promise<string>
  syncState(session: string): Promise<string>
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
export async function openNativeTransport(session:string,path:string,deviceId:string,now:string):Promise<{transport:EngineTransport;data:NativeDataApi;generation:number;revision:number}> {
  if(!native)throw new Error('Rust engine requires a development build with lift-engine included.')
  const info=await native.info()
  if(info.protocolVersion!==1)throw new Error('Unsupported Rust engine protocol. Rebuild the app.')
  const opened:QueryReply<unknown>=JSON.parse(await native.open(session,path,deviceId,now))
  const transport:EngineTransport={
    query:async(query)=>JSON.parse(await native.query(session,encode(query))),
    execute:async(id,generation,command,now,today):Promise<Receipt>=>JSON.parse(await native.execute(session,id,generation,encode(command),now,today)),
    close:()=>native.close(session),
  }
  const data: NativeDataApi={
    importFile:async(request)=>JSON.parse(await native.importFile(session,encode(request))),
    snapshotBytes:now=>native.snapshotBytes(session,now),
    backupBytes:slot=>native.backupBytes(session,slot),
    saveRestorePoint:now=>native.saveRestorePoint(session,now),
    restorePoints:async()=>JSON.parse(await native.restorePoints(session)),
    syncState:async()=>JSON.parse(await native.syncState(session)),
  }
  return {transport,data,generation:opened.generation,revision:opened.revision}
}
