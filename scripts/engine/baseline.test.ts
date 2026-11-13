import { test } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { emptySnapshot } from '../../packages/core/src/store/schema'
import { setSnapshot } from '../../packages/core/src/store/store'
import { addSet } from '../../packages/core/src/store/mutations'
import { recomputePrsForExercise } from '../../packages/core/src/store/prs'
import { getExerciseHistoryQ } from '../../packages/core/src/store/queries'
import { serialize, parse } from '../../packages/core/src/store/blob'

// Desktop diagnostics only: these numbers are not phone or bridge benchmarks.
test('capture synthetic TypeScript baseline', async () => {
  const results: object[] = []
  for (const count of [1_000, 10_000, 50_000, 100_000]) {
    const snap = emptySnapshot('synthetic-benchmark')
    snap.exercises = Array.from({length: 10}, (_, i) => ({id: i + 1, name: `Synthetic ${i}`, category: 'chest', kind: 'weight_reps', is_custom: true}))
    for (let i = 0; i < count / 10; i++) {
      const date = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10)
      const wid = 100 + i
      const weid = 100_000 + i
      snap.workouts.push({id: wid, date, status:'done', started_at:null, finished_at:null, gym:'', notes:'', created_at:date + 'T08:00:00.000Z'})
      snap.workout_exercises.push({id:weid, workout_id:wid, exercise_id:i % 10 + 1, order:0, note:''})
      for (let j = 0; j < 10; j++) snap.sets.push({id:1_000_000+i*10+j, workout_exercise_id:weid, weight:40+(i%80), reps:5+j, distance_m:null, distance_unit_display:'', time_seconds:null, is_planned:false, is_pr:false, was_pr:false, is_position_pr:false, was_position_pr:false, note:'', order:j, created_at:date+'T08:00:00.000Z'})
    }
    for (const operation of ['cloneAndHydrateIndexes', 'prExercise', 'history', 'addSet', 'serialize', 'parse'] as const) {
      const samples:number[]=[]
      const bytes = await serialize(snap)
      for (let sample = 0; sample < 6; sample++) {
        // Isolate each measurement against the same source dataset.
        setSnapshot(structuredClone(snap))
        const start = performance.now()
        switch(operation) {
          case 'cloneAndHydrateIndexes': setSnapshot(structuredClone(snap)); break
          case 'prExercise': recomputePrsForExercise(snap, 1); break
          case 'history': getExerciseHistoryQ(1); break
          case 'addSet': addSet(100_000, {weight:100,reps:5}); break
          case 'serialize': await serialize(snap); break
          case 'parse': await parse(bytes); break
        }
        if (sample > 0) samples.push(performance.now()-start)
      }
      results.push({sets:count, operation, samplesMs:samples, snapshotBytes:bytes.length})
    }
  }
  mkdirSync('benchmarks/local', {recursive:true})
  writeFileSync('benchmarks/local/typescript-baseline.json', JSON.stringify({node:process.version, platform:process.platform, arch:process.arch, kind:'desktop-diagnostic', results}, null, 2)+'\n')
}, 120_000)
