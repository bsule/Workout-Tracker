import 'fake-indexeddb/auto'
import { expect,it } from 'vitest'
import { createRequire } from 'node:module'
import { installWorkerRuntime } from '../../packages/engine-client/src/worker-runtime'
import { emptySnapshot } from '../../packages/core/src/store/schema'
const require=createRequire(import.meta.url)
const {BrowserEngine}=require('../../target/wasm-nodejs/lift_wasm.js')

it('runs actual Wasm with transactional browser adapter, retry and reopen',async()=>{
  let receive!:(event:any)=>void
  const pending=new Map<string,(message:any)=>void>()
  const scope={addEventListener:(_name:string,listener:any)=>{receive=listener},postMessage:(message:any)=>{pending.get(message.requestId)!(message);pending.delete(message.requestId)}}
  installWorkerRuntime(scope as any,BrowserEngine)
  let i=0
  const send=(operation:string,payload:any)=>new Promise<any>(resolve=>{const requestId=String(++i);pending.set(requestId,resolve);receive({data:{requestId,sessionId:'session',operation,payload}})})
  const accountKey=crypto.randomUUID()
  expect((await send('open',{accountKey,emptySnapshot:emptySnapshot('wasm-integration')})).error).toBeUndefined()
  const command={commandId:'one',generation:1,command:{op:'set_day_note',date:'2026-01-01',text:'durable'},now:'2026-01-01T12:00:00.000Z',today:'2026-01-01'}
  const first=await send('execute',command)
  expect(first.result.revision).toBe(1)
  expect((await send('execute',command)).result).toEqual(first.result)
  await send('close',{})
  await send('open',{accountKey})
  expect((await send('query',{query:{kind:'day_note',date:'2026-01-01'}})).result.data).toBe('durable')
  expect((await send('execute',{...command,command:{...command.command,text:'different'}})).error).toContain('different payload')
  await send('close',{})
})
