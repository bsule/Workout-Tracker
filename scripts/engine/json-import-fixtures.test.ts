import {test,vi} from 'vitest'
import {writeFileSync} from 'node:fs'
import {emptySnapshot} from '../../packages/core/src/store/schema'
import {setSnapshot,getState} from '../../packages/core/src/store/store'
import {importSnapshotJson} from '../../packages/core/src/import/snapshotJson'
import {installMemoryStorage} from '../../tests/helpers/store'

test('generate JSON import and repeated merge oracles',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  try{
    installMemoryStorage()
    const initial=emptySnapshot('json-test');initial.gyms=[{id:100000,name:'Home'}];setSnapshot(initial)
    const set=(weight:number,reps:number,order:number)=>({weight_kg:weight,reps,order,created_at:'2025-01-01T12:00:00.000Z'})
    const exercise=(name:string,kind:string,sets:any[])=>({exercise:{name,category:'chest',kind},sets,order:0,note:' exercise note '})
    const data={version:2,saved_gyms:['HOME','Other'],custom_exercises:[{name:'  Custom   lift ',category:'custom-category',kind:'weight_reps'}],day_notes:[{date:'2025-01-01',text:'day note'}],workouts:[
      {date:'2025-01-01',gym:'Home',notes:'first',exercises:[exercise('Bench Press','weight_reps',[set(56.699,5,0),set(60,7,1)]),exercise('Custom lift','weight_reps',[set(80,5,0)])]},
      {date:'2025-01-01',gym:'Other',notes:'second',exercises:[exercise('Bench Press','weight_reps',[set(70,5,0)])]},
      {date:'2025-01-02',gym:'Other',exercises:[exercise('Plank','time_only',[{time_seconds:60,order:0}])]},
      {date:'bad',exercises:[]},
    ]}
    const traces=[]
    let next_id=100001
    for(const [mode,payload]of [['replace',data],['merge',data],['merge',{...data,version:1,day_notes:[]}]] as const){
      const before=structuredClone(getState().snapshot)
      const result=await importSnapshotJson(JSON.stringify(payload),{mode})
      const expected=structuredClone(getState().snapshot)
      traces.push({initial:before,data:payload,replace:mode==='replace',next_id,result,expected})
      next_id=Math.max(next_id,...[...expected.exercises,...expected.workouts,...expected.workout_exercises,...expected.sets,...expected.gyms].map(r=>r.id+1))
    }
    writeFileSync('tests/engine-parity/json-import.json',JSON.stringify({now:new Date().toISOString(),today:'2026-01-01',traces})+'\n')
  }finally{vi.useRealTimers()}
})
