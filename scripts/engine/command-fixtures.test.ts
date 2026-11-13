import { test, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import * as M from '../../packages/core/src/store/mutations'
import * as Q from '../../packages/core/src/store/queries'
import {chartPoints,repRecordRows,weightRepSets} from '../../packages/core/src/exerciseStats'
import { buildJson } from '../../packages/core/src/export/snapshot'
import { emptySnapshot } from '../../packages/core/src/store/schema'
import { getState, setSnapshot } from '../../packages/core/src/store/store'

test('generate command trace',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  try {
    const initial=emptySnapshot('command-test');initial.gyms=[{id:1000,name:'Home'}];setSnapshot(initial)
    const steps:any[]=[]
    const step=<T>(command:any,run:()=>T):T=>{const result=run();const snapshot=getState().snapshot;
      const queries=[...snapshot.workouts.map(w=>({query:{kind:'workout',id:w.id},expected:Q.getWorkoutQ(w.id)})),
      ...[1,...snapshot.exercises.map(e=>e.id)].map(id=>{const days=Q.getExerciseHistoryQ(id);return {query:{kind:'history',exercise_id:id,offset:0,limit:100},expected:{total:days.length,items:days}}}),
      {query:{kind:'calendar',month:'2026-01'},expected:Q.getCalendarQ(2026,1)}];
      for(const id of [1,...snapshot.exercises.map(e=>e.id)]) {
        const days=Q.getExerciseHistoryQ(id)
        for(const metric of ['one_rm','heaviest','avg_weight','per_set'] as const) for(const unit of ['kg','lb'] as const) queries.push({query:{kind:'chart',exercise_id:id,metric,set_index:1,unit} as any,expected:chartPoints(days,metric,1,unit) as any})
        for(const sort of ['weight','oneRm','reps','recent'] as const) queries.push({query:{kind:'summary',exercise_id:id,sort,set_number:null} as any,expected:repRecordRows(weightRepSets(days),sort) as any})
      }
      steps.push({command,expected:structuredClone(snapshot),queries,exported:JSON.parse(buildJson(snapshot,"fixture"))});return result}
    step({op:'update_settings',patch:{weight_unit:'kg'}},()=>M.updateSettings({weight_unit:'kg'}))
    const ex=step({op:'create_exercise',name:' Custom bench ',category:'chest',kind:null},()=>M.createExercise({name:' Custom bench ',category:'chest'}))
    step({op:'patch_exercise',id:1,patch:{name:'Seed override'}},()=>M.patchExercise(1,{name:'Seed override'}))
    const w=step({op:'create_workout',date:'2026-01-01'},()=>M.createWorkout('2026-01-01')).row
    step({op:'patch_workout',id:w.id,patch:{gym:' HOME ',notes:'session'}},()=>M.patchWorkout(w.id,{gym:' HOME ',notes:'session'}))
    const we=step({op:'add_exercise',workout_id:w.id,exercise_id:ex.id},()=>M.addExerciseToWorkout(w.id,ex.id))
    const s=step({op:'add_set',we_id:we.id,input:{weight:56.699,reps:5}},()=>M.addSet(we.id,{weight:56.699,reps:5}))
    step({op:'add_set',we_id:we.id,input:{weight:56.70,reps:7}},()=>M.addSet(we.id,{weight:56.70,reps:7}))
    const planned=step({op:'add_set',we_id:we.id,input:{weight:100,reps:4,is_planned:true}},()=>M.addSet(we.id,{weight:100,reps:4,is_planned:true}))
    step({op:'log_planned_set',set_id:planned.id,patch:{reps:6}},()=>M.logPlannedSet(planned.id,{reps:6}))
    step({op:'update_set',set_id:s.id,patch:{weight:120,note:'edited'}},()=>M.updateSet(s.id,{weight:120,note:'edited'}))
    step({op:'set_exercise_note',we_id:we.id,text:' good '},()=>M.setExerciseNote(we.id,' good '))
    step({op:'set_day_note',date:w.date,text:' day '},()=>M.setDayNote(w.date,' day '))
    const older=step({op:'create_workout',date:'2025-12-31'},()=>M.createWorkout('2025-12-31')).row
    step({op:'copy_workout',source_id:w.id,target_id:older.id,with_sets:true},()=>M.copyFromWorkout(older.id,w.id,true))
    step({op:'delete_sets',ids:[s.id]},()=>M.deleteSets([s.id]))
    step({op:'rename_gym',id:1000,name:'Garage'},()=>M.renameGym(1000,'Garage'))
    step({op:'delete_exercise',id:ex.id},()=>M.deleteExercise(ex.id))
    step({op:'delete_workout',id:older.id},()=>M.deleteWorkout(older.id))
    step({op:'remove_exercise',we_id:we.id},()=>M.removeExerciseFromWorkout(w.id,we.id))
    step({op:'delete_gym',id:1000},()=>M.deleteGym(1000))
    step({op:'create_gym',name:'New gym'},()=>M.createGym('New gym'))
    step({op:'set_day_note',date:w.date,text:''},()=>M.setDayNote(w.date,''))
    writeFileSync('tests/engine-parity/commands.json',JSON.stringify({initial,now:new Date().toISOString(),today:'2026-01-01',steps})+'\n')
  }finally{vi.useRealTimers()}
})
