import {it,expect,vi} from 'vitest'
import {SnapshotHttp,SyncConflict} from '../packages/engine-client/src/snapshot-http'
import {EngineSync,type SyncEngine} from '../packages/engine-client/src/sync-client'

it('uses explicit conditional ETags and exact byte ranges',async()=>{
  const calls:any[]=[]
  const request=vi.fn(async(url:any,options:any)=>{calls.push({url,options});return new Response(JSON.stringify({etag:'new',quota:{remaining:4}}),{status:200})})
  const http=new SnapshotHttp('https://example.test/api/','account-A-token',request as typeof fetch)
  const data=new Uint8Array([9,1,2,9]);await http.push(data.subarray(1,3),'old','device A')
  expect(calls[0].options.headers.get('If-Match')).toBe('"old"')
  expect(calls[0].options.headers.get('Authorization')).toBe('Token account-A-token')
  expect(Array.from(new Uint8Array(calls[0].options.body))).toEqual([1,2])
  expect(calls[0].url).toContain('device=device%20A')
})
it('preview does not adopt remote state and conflict stays conditional',async()=>{
  const request=vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1]),{headers:{etag:'"remote"'}})).mockResolvedValueOnce(new Response(JSON.stringify({etag:'later'}),{status:412}))
  const http=new SnapshotHttp('https://example.test/api','token',request)
  expect((await http.preview())?.etag).toBe('remote')
  await expect(http.push(new Uint8Array([1]),'old','device')).rejects.toBeInstanceOf(SyncConflict)
  expect(request.mock.calls[1][1].headers.get('If-Match')).toBe('"old"')
})
it('late upload result cannot acknowledge a closed account',async()=>{
  let finish!:(value:Response)=>void
  const engine:SyncEngine={prepareUpload:async()=>({bytes:new Uint8Array([1]),generation:1,revision:5,etag:'old',deviceId:'device'}),acknowledgePush:vi.fn(async()=>{}),replaceSnapshot:vi.fn(async()=>{})}
  const http=new SnapshotHttp('https://example.test/api','token',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve})))
  const sync=new EngineSync(engine,http)
  const pending=sync.push();await vi.waitFor(()=>expect(finish).toBeDefined())
  sync.close();finish(new Response(JSON.stringify({etag:'new'})))
  await expect(pending).rejects.toThrow('closed')
  expect(engine.acknowledgePush).not.toHaveBeenCalled()
})
it('acknowledges the uploaded revision, preserving concurrent local edits for Rust to evaluate',async()=>{
  const engine:SyncEngine={prepareUpload:async()=>({bytes:new Uint8Array([1]),generation:2,revision:7,etag:'before',deviceId:'device'}),acknowledgePush:vi.fn(async()=>{}),replaceSnapshot:vi.fn(async()=>{})}
  const http=new SnapshotHttp('https://example.test/api','token',vi.fn(async()=>new Response(JSON.stringify({etag:'after'}))))
  const sync=new EngineSync(engine,http,()=> 'now');await sync.push()
  expect(engine.acknowledgePush).toHaveBeenCalledWith(2,7,'before','after','now')
  sync.close()
})
