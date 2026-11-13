import { requireOptionalNativeModule } from 'expo-modules-core'
import type { DataTransport } from '@lift/engine-client/data-api'
import type { UploadSnapshot } from '@lift/engine-client/sync-client'
import type { EngineTransport, QueryReply, Receipt } from '@lift/engine-client'

/**
 * Stable codes on native rejections, read as `error.code`.
 * - TOO_NEW: data or a database from a newer app; nothing was written.
 * - CORRUPT: no readable copy of the data (damaged files were left in place).
 * - STALE: the request was based on an older generation or revision.
 * - CLOSED: the session is closed.
 * - FAILED: anything else.
 */
export const EngineErrorCode = {
  TOO_NEW: 'ERR_ENGINE_TOO_NEW',
  CORRUPT: 'ERR_ENGINE_CORRUPT',
  STALE: 'ERR_ENGINE_STALE',
  CLOSED: 'ERR_ENGINE_CLOSED',
  FAILED: 'ERR_ENGINE',
} as const
export type EngineErrorCode = (typeof EngineErrorCode)[keyof typeof EngineErrorCode]
const ENGINE_CODES: ReadonlySet<string> = new Set(Object.values(EngineErrorCode))
/** The engine code on a rejection, or null when it did not come from the engine. */
export function engineErrorCode(e: unknown): string | null {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  return typeof code === 'string' && ENGINE_CODES.has(code) ? code : null
}

export interface ImportRequest {
  command_id: string; generation: number; revision: number
  format: 'json' | 'csv'; text: string; replace: boolean; now: string; today: string
}
export interface NativeDataApi extends DataTransport {
  parseAiPlan(raw: string): Promise<unknown>
  exportJson(username: string, now: string): Promise<string>
  exportFitnotes(skeleton: Uint8Array, now: string): Promise<Uint8Array>
  importFile(request: ImportRequest): Promise<Receipt>
  snapshotBytes(now: string): Promise<Uint8Array>
  backupBytes(slot: string): Promise<Uint8Array | null>
  saveRestorePoint(now: string): Promise<void>
  restorePoints(): Promise<Record<string, unknown>>
  syncState(): Promise<Record<string, unknown>>
}
interface EngineInfo { protocolVersion: number; engineVersion: string }
interface NativeModule {
  exportLegacyFitnotes(snapshotJson: string, skeleton: Uint8Array, now: string): Promise<Uint8Array>
  exportLegacyJson(snapshotJson: string, username: string, now: string): Promise<string>
  info(): Promise<EngineInfo>
  parseAiPlan(session: string, raw: string): Promise<string>
  exportJson(session: string, username: string, now: string): Promise<string>
  prepareUpload(session: string, now: string): Promise<UploadSnapshot>
  replaceSnapshot(session: string, bytes: Uint8Array, generation: number, revision: number, etag: string | null, now: string): Promise<string>
  acknowledgePush(session: string, generation: number, revision: number, expectedEtag: string | null, etag: string, now: string): Promise<void>
  exportFitnotes(session: string, skeleton: Uint8Array, now: string): Promise<Uint8Array>
  importFile(session: string, request: string): Promise<string>
  snapshotBytes(session: string, now: string): Promise<Uint8Array>
  backupBytes(session: string, slot: string): Promise<Uint8Array | null>
  saveRestorePoint(session: string, now: string): Promise<void>
  restorePoints(session: string): Promise<string>
  syncState(session: string): Promise<string>
  open(session: string, path: string, deviceId: string, now: string, legacyJson: string): Promise<string>
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
/**
 * `legacy.etag` is the cloud version the old TypeScript store last agreed
 * with. The engine adopts it only when this open migrates that store into a
 * new database; an etag the engine already holds is never replaced.
 */
export async function openNativeTransport(session:string,path:string,deviceId:string,now:string,legacy:{etag:string|null}):Promise<{transport:EngineTransport;data:NativeDataApi;generation:number;revision:number}> {
  if(!native)throw new Error('Rust engine requires a development build with lift-engine included.')
  const info=await native.info()
  if(info.protocolVersion!==1)throw new Error('Unsupported Rust engine protocol. Rebuild the app.')
  const opened:QueryReply<unknown>=JSON.parse(await native.open(session,path,deviceId,now,JSON.stringify({etag:legacy?.etag??null})))
  const transport:EngineTransport={
    query:async(query)=>JSON.parse(await native.query(session,encode(query))),
    execute:async(id,generation,command,now,today):Promise<Receipt>=>JSON.parse(await native.execute(session,id,generation,encode(command),now,today)),
    close:()=>native.close(session),
  }
  const data: NativeDataApi={
    parseAiPlan:async raw=>JSON.parse(await native.parseAiPlan(session,raw)),
    exportJson:(username,now)=>native.exportJson(session,username,now),
    prepareUpload:now=>native.prepareUpload(session,now),
    replaceSnapshot:async(bytes,generation,revision,etag,now)=>JSON.parse(await native.replaceSnapshot(session,bytes,generation,revision,etag,now)),
    acknowledgePush:(generation,revision,expectedEtag,etag,now)=>native.acknowledgePush(session,generation,revision,expectedEtag,etag,now),
    exportFitnotes:(skeleton,now)=>native.exportFitnotes(session,skeleton,now),
    importFile:async(request)=>JSON.parse(await native.importFile(session,encode(request))),
    snapshotBytes:now=>native.snapshotBytes(session,now),
    backupBytes:slot=>native.backupBytes(session,slot),
    saveRestorePoint:now=>native.saveRestorePoint(session,now),
    restorePoints:async()=>JSON.parse(await native.restorePoints(session)),
    syncState:async()=>JSON.parse(await native.syncState(session)),
  }
  return {transport,data,generation:opened.generation,revision:opened.revision}
}

/** Read-only migration bridge: never opens another authoritative store. */
export const nativeExports = {
  available: !!native,
  fitnotes(snapshot: unknown, skeleton: Uint8Array, now = new Date().toISOString()) {
    if (!native) throw new Error('Rust export requires a development build with lift-engine included.')
    return native.exportLegacyFitnotes(encode(snapshot), skeleton, now)
  },
  json(snapshot: unknown, username: string, now = new Date().toISOString()) {
    if (!native) throw new Error('Rust export requires a development build with lift-engine included.')
    return native.exportLegacyJson(encode(snapshot), username, now)
  },
}
