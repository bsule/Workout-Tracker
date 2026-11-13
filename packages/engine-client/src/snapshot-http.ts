/** Stateless wire adapter: reading a remote snapshot never adopts its ETag. */
export interface RemoteSnapshot { bytes: Uint8Array; etag: string }
/** The server's daily push budget (GET /api/sync/quota, and every push reply). */
export interface SyncQuota { used: number; limit: number; remaining: number; resets_at: string }
export class SyncConflict extends Error {
  constructor(readonly remoteEtag: string | null){super('Cloud snapshot changed. Choose whether to restore or overwrite it.')}
}
export class SyncQuotaError extends Error {
  constructor(readonly quota: SyncQuota | null){
    // Same copy as the legacy transport's SyncQuotaExceededError.
    super(quota ? `Daily sync limit reached (${quota.limit}/day). Resets at ${quota.resets_at}.` : 'Daily sync limit reached.')
    this.name = 'SyncQuotaError'
  }
}
const unquote = (etag: string) => etag.replace(/^"|"$/g, '')
export class SnapshotHttp {
  constructor(private apiBase:string,private token:string,private request:typeof fetch=(...args)=>fetch(...args)){}
  private headers(){return new Headers({Authorization:`Token ${this.token}`})}
  private url(path:string){return this.apiBase.replace(/\/+$/,'')+path}
  async preview(signal?:AbortSignal):Promise<RemoteSnapshot|null>{
    const response=await this.request(this.url('/sync/snapshot'),{headers:this.headers(),signal})
    if(response.status===204)return null
    if(!response.ok)throw new Error(`Snapshot download failed (${response.status}).`)
    const etag=unquote(response.headers.get('etag')??'')
    if(!etag)throw new Error('Snapshot response has no ETag.')
    return {bytes:new Uint8Array(await response.arrayBuffer()),etag}
  }
  async push(bytes:Uint8Array,etag:string|null,deviceId:string,signal?:AbortSignal):Promise<{etag:string;quota:SyncQuota|null}>{
    const headers=this.headers();headers.set('Content-Type','application/octet-stream')
    if(etag)headers.set('If-Match',`"${etag}"`);else headers.set('If-None-Match','*')
    const body=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
    const response=await this.request(this.url('/sync/snapshot?device='+encodeURIComponent(deviceId)),{method:'PUT',headers,body,signal})
    const data=await response.json().catch(()=>null)
    if(response.status===412)throw new SyncConflict(typeof data?.etag==='string'?unquote(data.etag):null)
    if(response.status===429)throw new SyncQuotaError(data?.quota??null)
    if(!response.ok)throw new Error(`Snapshot upload failed (${response.status}).`)
    if(typeof data?.etag!=='string'||!data.etag)throw new Error('Upload response has no ETag.')
    return {etag:unquote(data.etag),quota:data.quota??null}
  }
  /** Free: reading the budget does not spend it. */
  async quota(signal?:AbortSignal):Promise<SyncQuota>{
    const response=await this.request(this.url('/sync/quota'),{headers:this.headers(),signal})
    if(!response.ok)throw new Error(`getQuota failed: ${response.status}`)
    return await response.json() as SyncQuota
  }
}
