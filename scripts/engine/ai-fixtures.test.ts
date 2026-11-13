import {test,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {parseAiPlanResponse} from '../../packages/core/src/ai/parse'
import {applyPlan} from '../../packages/core/src/ai/applyPlan'
import {emptySnapshot} from '../../packages/core/src/store/schema'
import {setSnapshot,getState} from '../../packages/core/src/store/store'

test('capture AI plan parsing and application',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  try{
    const raw='Here is your plan:\n```json\n'+JSON.stringify({days:[{date:'bad',exercises:[]},{date:'2026-01-02',exercises:[{name:' Bench Press ',category:'chest',kind:'weight_reps',sets:[{weight:'135',reps:'5',note:'first'},{weight:'',reps:6}]},{name:'ZZZ-Unique New Exercise',category:'invalid',kind:'bodyweight_reps',sets:[{reps:12}]}]},{date:'2026-01-03',exercises:[{name:'Treadmill',sets:[{distance_m:'400',time_seconds:'x'}]}]}]})+'\n```'
    const plan=parseAiPlanResponse(raw)
    const initial=emptySnapshot('ai-test');initial.gyms=[{id:200000,name:'Home'}];setSnapshot(initial)
    const result=await applyPlan(plan,'lb')
    writeFileSync('tests/engine-parity/ai.json',JSON.stringify({raw,plan,initial,expected:getState().snapshot,result,now:new Date().toISOString(),today:'2026-01-01',next_id:200001})+'\n')
  }finally{vi.useRealTimers()}
})
