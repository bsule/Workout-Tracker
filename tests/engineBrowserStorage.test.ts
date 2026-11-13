import 'fake-indexeddb/auto'
import { expect,it } from 'vitest'
import { BrowserStorage, type WriteSet } from '../packages/engine-client/src/browser-storage'

it('commits rows and receipts atomically and refuses stale writers',async()=>{
  const name='engine-test-'+crypto.randomUUID()
  const db=await BrowserStorage.open(name)
  const writes:WriteSet={base_revision:0,base_generation:1,revision:1,generation:1,next_id:2,header:{schema_version:9},rows:[{table:'day_notes',key:'2026-01-01',value:{date:'2026-01-01',text:'saved'},ordinal:0}],receipt:{command_id:'one',generation:1,revision:1}}
  await db.commit(writes)
  expect((await db.load())?.snapshot.day_notes).toEqual([{date:'2026-01-01',text:'saved'}])
  await expect(db.commit({...writes,receipt:{command_id:'two',generation:1}})).rejects.toThrow('Concurrent writer')
  expect(await db.receipt(1,'two')).toBeUndefined()
  db.close()
  const reopened=await BrowserStorage.open(name)
  expect((await reopened.load())?.meta.revision).toBe(1)
  expect(await reopened.receipt(1,'one')).toEqual(writes.receipt)
  reopened.close()
})

it('publishes replacement generations atomically and rejects old writers',async()=>{
  const db=await BrowserStorage.open('replacement-'+crypto.randomUUID())
  const base:WriteSet={base_revision:0,base_generation:1,revision:1,generation:1,next_id:1,header:{schema_version:9},rows:[],receipt:{command_id:'initial',generation:1}}
  await db.commit(base)
  await db.commit({...base,base_revision:1,revision:2,generation:2,receipt:{command_id:'replace',generation:2}})
  expect((await db.load())?.meta.generation).toBe(2)
  await expect(db.commit({...base,base_revision:2,revision:3,receipt:{command_id:'old',generation:1}})).rejects.toThrow('Concurrent writer')
  expect(await db.receipt(1,'old')).toBeUndefined()
  expect(await db.receipt(2,'replace')).toBeDefined()
  db.close()
})
