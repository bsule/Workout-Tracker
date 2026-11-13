import {expect,it,vi} from 'vitest'
import {AccountSessions,type OpenedEngine} from '../packages/engine-client/src/session'
it('late account open closes before another account starts',async()=>{
  let resolve!:(engine:OpenedEngine)=>void
  const events:string[]=[]
  const transport=(key:string)=>({query:async()=>({generation:1,revision:0,data:null}),execute:async()=>{throw Error('unused')},close:async()=>{events.push('close:'+key)}})
  const sessions=new AccountSessions(async key=>{events.push('open:'+key);if(key==='a')return new Promise(r=>{resolve=r});return {transport:transport(key),generation:1,revision:0}},'test')
  const a=sessions.switchAccount('a');await vi.waitFor(()=>expect(resolve).toBeDefined())
  const b=sessions.switchAccount('b');expect(sessions.getSnapshot()).toEqual({status:'opening',accountKey:'b'})
  resolve({transport:transport('a'),generation:1,revision:0});await a;await b
  const state=sessions.getSnapshot();expect(state.status).toBe('ready');if(state.status==='ready')expect(state.session.accountKey).toBe('b')
  expect(events).toEqual(['open:a','close:a','open:b'])
  await sessions.switchAccount(null);expect(events.at(-1)).toBe('close:b');expect(sessions.getSnapshot()).toEqual({status:'closed'})
})
