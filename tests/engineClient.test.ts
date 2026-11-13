import { expect, it } from 'vitest'
import { EngineClient, type EngineTransport } from '../packages/engine-client/src/index'

it('drops late query data after closing the account', async () => {
  let resolve!: (value:any)=>void
  let notified=0, closed=0
  const transport:EngineTransport={query:()=>new Promise(r=>{resolve=r}),execute:async()=>{throw Error('unused')},close:async()=>{closed++}}
  const client=new EngineClient(transport,1)
  client.subscribe('day',{kind:'day_note',date:'2026-01-01'},()=>notified++)
  await client.close()
  resolve({generation:1,revision:0,data:'old account'})
  await Promise.resolve()
  expect(notified).toBe(0);expect(closed).toBe(1)
})

it('serializes accepted mutations and keeps failed commands from blocking later writes', async()=>{
  const seen:string[]=[]
  const transport:EngineTransport={query:async()=>({generation:1,revision:2,data:null}),execute:async(id)=>{
    seen.push(id);if(id==='bad')throw Error('disk failed');return {command_id:id,generation:1,revision:2,result:null}
  },close:async()=>{}}
  const client=new EngineClient(transport,1)
  const bad=client.execute('bad',{},'now','today')
  const good=client.execute('good',{},'now','today')
  await expect(bad).rejects.toThrow('disk failed');expect((await good).command_id).toBe('good')
  expect(seen).toEqual(['bad','good']);await client.close()
})
