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

it('serializes replacements with commands and refreshes subscribed queries in the new generation',async()=>{
  let generation=1, revision=4
  const events:string[]=[]
  const transport:EngineTransport={query:async()=>({generation,revision,data:generation}),execute:async(id,gen)=>{
    events.push(`edit:${gen}`);revision++;return {command_id:id,generation:gen,revision,result:null}
  },close:async()=>{}}
  const client=new EngineClient(transport,1,4)
  const query={kind:'counts'}
  client.subscribe('counts',query,()=>{})
  await Promise.resolve();await Promise.resolve()
  const replace=client.commit(async version=>{
    events.push(`replace:${version.revision}`);generation++;revision++
    return {command_id:'replace',generation,revision,result:null}
  })
  const edit=client.execute('next',{},'now','today')
  await replace;await edit;await Promise.resolve();await Promise.resolve()
  expect(events).toEqual(['replace:4','edit:2'])
  expect(client.version).toEqual({generation:2,revision:6})
  expect(client.snapshot('counts',query)).toEqual({status:'ready',value:2,revision:6})
  await client.close()
})

it('selectively invalidates only affected queries on command execution', async () => {
  let settingsRefreshes = 0
  let workoutRefreshes = 0
  let revision = 1
  const transport: EngineTransport = {
    query: async (q: any) => {
      if (q.kind === 'settings') settingsRefreshes++
      if (q.kind === 'workout_by_date') workoutRefreshes++
      return { generation: 1, revision, data: {} }
    },
    execute: async (id) => {
      revision++
      return { command_id: id, generation: 1, revision, result: null }
    },
    close: async () => {},
  }
  const client = new EngineClient(transport, 1, 1)
  client.subscribe('settings', { kind: 'settings' }, () => {})
  client.subscribe('workout:today', { kind: 'workout_by_date', date: '2026-01-01' }, () => {})
  await Promise.resolve(); await Promise.resolve()
  expect(settingsRefreshes).toBe(1)
  expect(workoutRefreshes).toBe(1)

  // Updating settings should ONLY refresh settings, not workout
  await client.execute('cmd1', { op: 'update_settings', patch: {} }, 'now', 'today')
  await Promise.resolve(); await Promise.resolve()
  expect(settingsRefreshes).toBe(2)
  expect(workoutRefreshes).toBe(1)

  // Adding a set should NOT refresh settings, but should refresh workout
  await client.execute('cmd2', { op: 'add_set', we_id: 1, input: { reps: 5 } }, 'now', 'today')
  await Promise.resolve(); await Promise.resolve()
  expect(settingsRefreshes).toBe(2)
  expect(workoutRefreshes).toBe(2)

  await client.close()
})

