import {test,vi} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {emptySnapshot} from '../../packages/core/src/store/schema'
import {setSnapshot,getState} from '../../packages/core/src/store/store'
import {importFitnotesCsv} from '../../packages/core/src/import/fitnotesCsv'
import {installMemoryStorage} from '../../tests/helpers/store'

test('generate CSV import reference',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  try {
    installMemoryStorage()
    const initial=emptySnapshot('import-test');initial.gyms=[{id:10000,name:'Home'}];setSnapshot(initial)
    const csv=readFileSync('tests/fixtures/fitnotes-sample.csv','utf8')
    const result=await importFitnotesCsv(csv,{mode:'replace'})
    writeFileSync('tests/engine-parity/fitnotes.json',JSON.stringify({initial,csv,result,expected:getState().snapshot,now:new Date().toISOString(),today:'2026-01-01',next_id:10001})+'\n')
  }finally{vi.useRealTimers()}
})
