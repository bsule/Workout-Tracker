import {expect,it,vi} from 'vitest'
import {EngineClient,type EngineTransport} from '../packages/engine-client/src/index'
import {EngineDataApi,type DataTransport} from '../packages/engine-client/src/data-api'

// Restore points, uploads and exports compress the whole snapshot. They must
// include every write accepted before them, but a set saved while one runs
// must not wait for the compression to finish.

function setup(){
  let revision=5
  const events:string[]=[]
  const transport:EngineTransport={
    query:async()=>({generation:1,revision,data:null}),
    execute:async id=>{events.push(`save:${id}`);revision++;return {command_id:id,generation:1,revision,result:null}},
    close:vi.fn(async()=>{events.push('close')}),
  }
  const client=new EngineClient(transport,1,revision)
  let finishCapture!:()=>void
  const data={
    saveRestorePoint:vi.fn(()=>{events.push('restore-point:start');return new Promise<void>(r=>{finishCapture=()=>{events.push('restore-point:end');r()}})}),
  } as unknown as DataTransport
  const api=new EngineDataApi(client,data,'test',()=>new Date('2026-01-01T12:00:00.000Z'))
  return {client,api,data,events,transport,finish:()=>finishCapture()}
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve()}

it('a set saved during a restore point lands before the restore point finishes',async()=>{
  const {client,api,events,finish}=setup()
  const before=client.execute('a',{},'now','today')
  const point=api.saveRestorePoint()
  await before;await tick()
  // The capture started only after the earlier save, so it includes it.
  expect(events).toEqual(['save:a','restore-point:start'])
  const during=client.execute('b',{},'now','today')
  await during
  expect(events).toEqual(['save:a','restore-point:start','save:b'])
  finish();await point
  expect(events.at(-1)).toBe('restore-point:end')
  await client.close()
})

it('skips a restore point when nothing was committed since the last one',async()=>{
  const {client,api,data,finish}=setup()
  const first=api.saveRestorePoint();await tick();finish();await first
  await api.saveRestorePoint()
  expect(data.saveRestorePoint).toHaveBeenCalledTimes(1)
  await client.execute('c',{},'now','today')
  const second=api.saveRestorePoint();await tick();finish();await second
  expect(data.saveRestorePoint).toHaveBeenCalledTimes(2)
  await client.close()
})

it('close waits for a capture in flight before tearing the session down',async()=>{
  const {client,api,events,finish}=setup()
  const point=api.saveRestorePoint();await tick()
  const closing=client.close();await tick()
  expect(events).not.toContain('close')
  finish();await point.catch(()=>{});await closing
  expect(events).toEqual(['restore-point:start','restore-point:end','close'])
})

it('a failed restore point does not count as saved, so the next attempt runs',async()=>{
  const {client,api,data}=setup()
  ;(data.saveRestorePoint as any).mockImplementationOnce(async()=>{throw Error('disk full')})
  await expect(api.saveRestorePoint()).rejects.toThrow('disk full')
  ;(data.saveRestorePoint as any).mockImplementationOnce(async()=>{})
  await api.saveRestorePoint()
  expect(data.saveRestorePoint).toHaveBeenCalledTimes(2)
  await client.close()
})

it('coalesces overlapping restore points for the same committed version',async()=>{
  const {client,api,data,finish}=setup()
  const first=api.saveRestorePoint()
  const second=api.saveRestorePoint()
  await tick()
  expect(data.saveRestorePoint).toHaveBeenCalledTimes(1)
  finish()
  await Promise.all([first,second])
  await api.saveRestorePoint()
  expect(data.saveRestorePoint).toHaveBeenCalledTimes(1)
  await client.close()
})

it('close drains a capture accepted before its earlier write finished',async()=>{
  const {client,api,data,events,finish}=setup()
  const before=client.execute('before-close',{},'now','today').catch(()=>{})
  const point=api.saveRestorePoint()
  const checked=point.catch(()=>{})
  const closing=client.close()
  await before
  await tick()
  expect(data.saveRestorePoint).toHaveBeenCalledOnce()
  expect(events).not.toContain('close')
  finish()
  await checked
  await closing
  expect(events.at(-1)).toBe('close')
})
