import {expect,it,vi} from 'vitest'
import {EngineClient,type EngineTransport} from '../packages/engine-client/src/index'
import {EngineDataApi,type DataTransport} from '../packages/engine-client/src/data-api'

it('imports after accepted edits, advances generation, then captures uploads from the committed revision',async()=>{
  let generation=1,revision=10
  const events:string[]=[]
  const transport:EngineTransport={query:async()=>({generation,revision,data:null}),execute:async id=>{
    events.push('edit');revision++;return {command_id:id,generation,revision,result:null}
  },close:async()=>{}}
  const client=new EngineClient(transport,generation,revision)
  const data={importFile:vi.fn(async request=>{
    events.push('import');expect(request.generation).toBe(1);expect(request.revision).toBe(11)
    generation++;revision++
    return {command_id:request.command_id,generation,revision,result:null}
  }),prepareUpload:vi.fn(async()=>{
    events.push('upload');return {bytes:new Uint8Array([1]),generation,revision,etag:null,deviceId:'install'}
  }),replaceSnapshot:vi.fn()} as unknown as DataTransport
  const api=new EngineDataApi(client,data,'test',()=>new Date('2026-01-01T12:00:00.000Z'))
  const edit=client.execute('edit',{},'now','today')
  const imported=api.importFile('json','{}',true,'retryable-import')
  const upload=api.prepareUpload('now')
  await edit;await imported
  expect(await upload).toMatchObject({generation:2,revision:12})
  expect(events).toEqual(['edit','import','upload'])
  await expect(api.replaceSnapshot(new Uint8Array(),1,10,'remote','now')).rejects.toThrow('Local data changed')
  expect(data.replaceSnapshot).not.toHaveBeenCalled()
  await client.close()
})

it('repeated close waits for the same native teardown',async()=>{
  let resolve!:()=>void
  const transport:EngineTransport={query:async()=>({generation:1,revision:0,data:null}),execute:async()=>{throw Error('unused')},close:vi.fn(()=>new Promise<void>(r=>{resolve=r}))}
  const client=new EngineClient(transport,1)
  const first=client.close(),second=client.close()
  expect(first).toBe(second)
  await Promise.resolve();expect(transport.close).toHaveBeenCalledOnce()
  resolve();await Promise.all([first,second])
})
