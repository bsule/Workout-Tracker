/** Stateless wire adapter: reading a remote snapshot never adopts its ETag. */
export interface RemoteSnapshot { bytes: Uint8Array; etag: string }
export class SyncConflict extends Error {
  constructor(readonly remoteEtag: string | null){super('Cloud snapshot changed. Choose whether to restore or overwrite it.')}
}
export class SyncQuotaError extends Error {
  constructor(readonly quota: unknown){super('Daily sync quota exceeded.')}
}
export class SnapshotHttp {
  constructor(private apiBase:string,private token:string,private request:typeof fetch=fetch){}
  private headers(){return new Headers({Authorization:`Token ${this.token}`})}
  async preview(signal?:AbortSignal):Promise<RemoteSnapshot|null>{
    const response=await this.request(this.apiBase.replace(/\/+$/,'')+'/sync/snapshot',{headers:this.headers(),signal})
    if(response.status===204)return null
    if(!response.ok)throw new Error(`Snapshot download failed (${response.status}).`)
    const etag=(response.headers.get('etag')??'').replace(/^"|"$/g,'')
    if(!etag)throw new Error('Snapshot response has no ETag.')
    return {bytes:new Uint8Array(await response.arrayBuffer()),etag}
  }
  async push(bytes:Uint8Array,etag:string|null,deviceId:string,signal?:AbortSignal):Promise<{etag:string;quota:unknown}>{
    const headers=this.headers();headers.set('Content-Type','application/octet-stream')
    if(etag)headers.set('If-Match',`"${etag}"`);else headers.set('If-None-Match','*')
    const body=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
    const response=await this.request(this.apiBase.replace(/\/+$/,'')+'/sync/snapshot?device='+encodeURIComponent(deviceId),{method:'PUT',headers,body,signal})
    const data=await response.json().catch(()=>null)
    if(response.status===412)throw new SyncConflict(typeof data?.etag==='string'?data.etag.replace(/^"|"$/g,''):null)
    if(response.status===429)throw new SyncQuotaError(data?.quota??null)
    if(!response.ok)throw new Error(`Snapshot upload failed (${response.status}).`)
    if(typeof data?.etag!=='string'||!data.etag)throw new Error('Upload response has no ETag.')
    return {etag:data.etag,quota:data.quota??null}
  }
}
