import {SnapshotHttp,type RemoteSnapshot} from './snapshot-http'
export interface UploadSnapshot {bytes:Uint8Array;generation:number;revision:number;etag:string|null;deviceId:string}
export interface SyncEngine {
  prepareUpload(now:string):Promise<UploadSnapshot>
  acknowledgePush(generation:number,revision:number,expectedEtag:string|null,etag:string,now:string):Promise<void>
  replaceSnapshot(bytes:Uint8Array,generation:number,revision:number,etag:string,now:string):Promise<unknown>
}
/** Captures account credentials in SnapshotHttp at session creation. Late HTTP
 * responses cannot write through an engine that has been closed or replaced. */
export class EngineSync {
  private active=true
  private abort=new AbortController()
  private running:Promise<void>|null=null
  constructor(private engine:SyncEngine,private http:SnapshotHttp,private now=()=>new Date().toISOString()){}
  preview():Promise<RemoteSnapshot|null>{
    if(!this.active)return Promise.reject(new Error('Sync session closed.'))
    return this.http.preview(this.abort.signal).then(result=>{this.check();return result})
  }
  push(overwriteEtag?:string|null):Promise<void>{
    if(!this.active)return Promise.reject(new Error('Sync session closed.'))
    if(this.running)return this.running
    const run=(async()=>{
      const source=await this.engine.prepareUpload(this.now());this.check()
      const expected=overwriteEtag===undefined?source.etag:overwriteEtag
      const result=await this.http.push(source.bytes,expected,source.deviceId,this.abort.signal);this.check()
      // Overwrite uses a refreshed remote precondition but local adoption still
      // checks the ETag that was current when the source was captured.
      await this.engine.acknowledgePush(source.generation,source.revision,source.etag,result.etag,this.now())
    })()
    this.running=run.finally(()=>{this.running=null});return this.running
  }
  async applyRemote(remote:RemoteSnapshot,generation:number,revision:number):Promise<void>{
    this.check()
    if(this.running)throw new Error('Wait for the current upload before replacing data.')
    await this.engine.replaceSnapshot(remote.bytes,generation,revision,remote.etag,this.now());this.check()
  }
  close(){this.active=false;this.abort.abort()}
  private check(){if(!this.active)throw new Error('Sync session closed.')}
}
