import {test,vi} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {unzipSync} from 'fflate'
import {buildFitnotesDb} from '../../packages/core/src/export/fitnotesDb'
import type {Snapshot} from '../../packages/core/src/store/schema'
const init=createRequire(import.meta.url)('sql.js')
test('capture FitNotes native export reference',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
  try{
    const trace=JSON.parse(readFileSync('tests/engine-parity/commands.json','utf8'))
    const snapshot:Snapshot=trace.steps[14].expected
    // Include implicit built-in rows and cardio alongside custom lifts.
    snapshot.workout_exercises.push({id:200000,workout_id:snapshot.workouts[0].id,exercise_id:1,order:4,note:''})
    snapshot.sets.push({...snapshot.sets[0],id:200001,workout_exercise_id:200000,weight:80,reps:8})
    snapshot.workout_exercises.push({id:200002,workout_id:snapshot.workouts[0].id,exercise_id:57,order:5,note:''})
    snapshot.sets.push({...snapshot.sets[0],id:200003,workout_exercise_id:200002,weight:null,reps:null,distance_m:1609.344,distance_unit_display:'mi',time_seconds:600})
    const SQL=await init()
    const zip=await buildFitnotesDb(snapshot,{skeletonBytes:new Uint8Array(readFileSync('mobile/assets/fitnotes_skeleton.fitnotesdb')),SQL})
    const db=new SQL.Database(unzipSync(zip)['database.fitnotesdb'])
    const tables=['ZWORKOUT','ZWORKOUTEXERCISE','ZWORKOUTSET']
    const queries=tables.map(table=>{
      const columns=db.exec(`PRAGMA table_info(${table})`)[0].values.map((r:any[])=>r[1]).filter((c:string)=>!['ZUUID1','ZUUID2'].includes(c))
      const sql=`SELECT ${columns.join(',')} FROM ${table} ORDER BY Z_PK`
      return {sql,rows:db.exec(sql)[0]?.values??[]}
    })
    const sql='SELECT ZNAME,ZKINDINT,ZCATEGORY,ZRESTTIME,ZUNITINT FROM ZEXERCISE WHERE Z_PK IN (SELECT ZEXERCISE FROM ZWORKOUTEXERCISE) ORDER BY Z_PK'
    queries.push({sql,rows:db.exec(sql)[0].values})
    writeFileSync('tests/engine-parity/fitnotes-export.json',JSON.stringify({snapshot,now:new Date().toISOString(),queries})+'\n')
    db.close()
  }finally{vi.useRealTimers()}
})
