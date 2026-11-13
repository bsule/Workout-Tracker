import {EngineClient,type Receipt} from './index'
import type {SyncEngine,UploadSnapshot} from './sync-client'
export interface ImportRequest {
  command_id:string;generation:number;revision:number
  format:'json'|'csv';text:string;replace:boolean;now:string;today:string
}
export interface DataTransport {
  importFile(request:ImportRequest):Promise<Receipt>
  replaceSnapshot(bytes:Uint8Array,generation:number,revision:number,etag:string|null,now:string):Promise<Receipt>
  prepareUpload(now:string):Promise<UploadSnapshot>
  acknowledgePush(generation:number,revision:number,expectedEtag:string|null,etag:string,now:string):Promise<void>
  snapshotBytes(now:string):Promise<Uint8Array>
  backupBytes(slot:string):Promise<Uint8Array|null>
  saveRestorePoint(now:string):Promise<void>
  restorePoints():Promise<Record<string,unknown>>
  syncState():Promise<Record<string,unknown>>
  parseAiPlan(raw:string):Promise<unknown>
  exportJson(username:string,now:string):Promise<string>
  exportFitnotes(skeleton:Uint8Array,now:string):Promise<Uint8Array>
}
/** Bulk operations participate in the same session queue and revision cache as
 * set edits. Hosts keep file pickers, sharing, HTTP, and credentials. */
export class EngineDataApi implements SyncEngine {
  private sequence=0
  constructor(private client:EngineClient,private data:DataTransport,private prefix:string,private clock=()=>new Date()){}
  importFile(format:'json'|'csv',text:string,replace:boolean,commandId?:string){
    const at=this.clock()
    const now=at.toISOString(),today=[at.getFullYear(),String(at.getMonth()+1).padStart(2,'0'),String(at.getDate()).padStart(2,'0')].join('-')
    return this.client.commit(version=>this.data.importFile({command_id:commandId??`${this.prefix}:import:${++this.sequence}`,...version,format,text,replace,now,today}))
  }
  replaceSnapshot(bytes:Uint8Array,generation:number,revision:number,etag:string|null,now:string){
    return this.client.commit(version=>{
      if(version.generation!==generation||version.revision!==revision)throw new Error('Local data changed; preview the snapshot again before replacing.')
      return this.data.replaceSnapshot(bytes,generation,revision,etag,now)
    })
  }
  /** The committed version once every accepted write has landed. */
  currentVersion(){return this.client.effect(version=>Promise.resolve(version))}
  async restore(slot:string,generation:number,revision:number){
    return this.client.commit(async version=>{
      if(version.generation!==generation||version.revision!==revision)throw new Error('Local data changed; review the restore point again.')
      const bytes=await this.data.backupBytes(slot)
      if(!bytes)throw new Error('Restore point no longer exists.')
      return this.data.replaceSnapshot(bytes,generation,revision,null,this.clock().toISOString())
    })
  }
  prepareUpload(now:string){return this.client.effect(()=>this.data.prepareUpload(now))}
  acknowledgePush(generation:number,revision:number,expectedEtag:string|null,etag:string,now:string){return this.client.effect(()=>this.data.acknowledgePush(generation,revision,expectedEtag,etag,now))}
  snapshotBytes(){return this.client.effect(()=>this.data.snapshotBytes(this.clock().toISOString()))}
  saveRestorePoint(){return this.client.effect(()=>this.data.saveRestorePoint(this.clock().toISOString()))}
  restorePoints(){return this.client.effect(()=>this.data.restorePoints())}
  syncState(){return this.client.effect(()=>this.data.syncState())}
  parseAiPlan(raw:string){return this.client.effect(()=>this.data.parseAiPlan(raw))}
  exportJson(username:string){return this.client.effect(()=>this.data.exportJson(username,this.clock().toISOString()))}
  exportFitnotes(skeleton:Uint8Array){return this.client.effect(()=>this.data.exportFitnotes(skeleton,this.clock().toISOString()))}
}
