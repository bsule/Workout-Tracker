import { test, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'fflate'
import { recomputePrsForExercise } from '../../packages/core/src/store/prs'
import { parse } from '../../packages/core/src/store/blob'
import { blankSnapshot, exercise, workout, we, set } from '../../tests/helpers/build'
import { SEED_EXERCISES } from '../../packages/core/src/store/seed'

test('generate snapshot and PR compatibility fixtures', async () => {
  let seed = 42
  const random = (max:number) => { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max }
  const snap=blankSnapshot()
  snap.exported_at='2026-01-01T00:00:00.000Z'
  snap.exercises=[exercise(1,'Bench'),exercise(2,'Squat'),exercise(3,'Run','cardio','distance_time')]
  for(let day=0;day<16;day++) {
    snap.workouts.push(workout(day+1,`2026-01-${String(1+Math.floor(day/2)).padStart(2,'0')}`))
    snap.workout_exercises.push(we(day+1,day+1,day%3+1,day%2))
    for(let i=0;i<5;i++) snap.sets.push(set(day*5+i+1,day+1,{
      weight:random(8)*5+50+random(2)*0.0001,reps:1+random(12),order:Math.floor(i/2),
      created_at:`2026-01-01T08:00:0${random(5)}.000Z`,is_planned:random(7)===0,
      is_pr:true,was_pr:true,is_position_pr:true,was_position_pr:true,
    }))
  }
  const prs=[]
  for(let pass=0;pass<8;pass++) {
    let result=structuredClone(snap)
    for(const id of [1,2,3]) result=recomputePrsForExercise(result,id)
    prs.push({input:structuredClone(snap),expected:result})
    snap.sets.splice(random(snap.sets.length),1)
    snap.sets[random(snap.sets.length)].weight=120+pass
  }
  const migrations=[]
  for(let version=1;version<=9;version++) {
    const input:any=structuredClone(snap); input.schema_version=version
    if(version<2) {for(const e of input.exercises) delete e.kind; for(const s of input.sets) {delete s.distance_m;delete s.distance_unit_display;delete s.time_seconds}}
    if(version<4) for(const s of input.sets) {delete s.is_position_pr;delete s.was_position_pr}
    if(version<5) {delete input.day_notes; input.workouts[0].notes='legacy day note'}
    if(version<7) for(const w of input.workout_exercises) delete w.note
    const {snapshot:expected,migrated}=await parse(gzipSync(new TextEncoder().encode(JSON.stringify(input))))
    migrations.push({input,expected,migrated})
  }
  expect(prs.length).toBe(8)
  writeFileSync('tests/engine-parity/prs.json',JSON.stringify(prs)+'\n')
  writeFileSync('tests/engine-parity/migrations.json',JSON.stringify(migrations)+'\n')
  writeFileSync('crates/lift-domain/src/seeds.json',JSON.stringify(SEED_EXERCISES,null,2)+'\n')
})
