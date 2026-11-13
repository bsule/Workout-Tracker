import { test, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setSnapshot, getState } from '../../packages/core/src/store/store'
import { addSet, updateSet, deleteSet, recomputeAllPrs } from '../../packages/core/src/store/mutations'
import { getCalendarQ, getWorkoutByDateQ } from '../../packages/core/src/store/queries'
import { predictPrFlags } from '../../packages/core/src/store/prs'
import { serialize, parse } from '../../packages/core/src/store/blob'
import type { Snapshot } from '../../packages/core/src/store/schema'

// Matched workloads against the exact fixtures emitted by the Rust benchmark.
// Mutations here have no configured storage: measure computation separately
// from the old periodic gzip save and the native SQLite commit.
test('TypeScript operation timings against the Rust fixtures', async () => {
  const results: object[] = []
  const directory = mkdtempSync(join(tmpdir(), 'lift-operations-bench-'))
  for (const count of [1_000, 10_000, 100_000, 250_000]) {
    const fixture: Snapshot = JSON.parse(readFileSync(`benchmarks/local/operations-fixture-${count}.json`, 'utf8'))
    setSnapshot(fixture)
    const target = fixture.workout_exercises.at(-1)!
    const date = fixture.workouts.at(-1)!.date
    const [year, month] = date.split('-').map(Number)
    const samples = new Map<string, number[]>()
    const path = join(directory, `snapshot-${count}.bin`)
    writeFileSync(path, await serialize(fixture))
    for (let sample = 0; sample < 8; sample++) {
      const time = <T>(name: string, action: () => T): T => {
        const start = performance.now()
        const value = action()
        record(name, performance.now() - start)
        return value
      }
      const record = (name: string, ms: number) => {
        if (sample === 0) return
        const values = samples.get(name) ?? []
        values.push(ms); samples.set(name, values)
      }
      const row = time('addSet', () => addSet(target.id, { weight: 100, reps: 5, created_at: '2026-11-12T12:00:00.000Z' }))
      time('editSet', () => updateSet(row.id, { weight: 105, reps: 6 }))
      time('deleteSet', () => deleteSet(row.id))
      time('recomputeAllPrs', recomputeAllPrs)
      time('predictPr', () => predictPrFlags(getState().indexes, target.exercise_id, target.id, 100, 5))
      time('predictPrQueued', () => predictPrFlags(getState().indexes, target.exercise_id, target.id, 100, 5, [{ weight: 100, reps: 5 }, { weight: 105, reps: 5 }]))
      time('loadWorkoutDay', () => getWorkoutByDateQ(date))
      time('loadCalendarMonth', () => getCalendarQ(year, month))
      const start = performance.now()
      const bytes = readFileSync(path)
      const { snapshot } = await parse(bytes)
      setSnapshot(snapshot)
      record('openPersistedSnapshot', performance.now() - start)
      expect(getState().snapshot.sets.length).toBe(count)
    }
    for (const [operation, samplesMs] of samples) {
      const sorted = [...samplesMs].sort((a, b) => a - b)
      results.push({ sets: count, operation, samplesMs, medianMs: sorted[Math.floor(sorted.length / 2)] })
    }
  }
  mkdirSync('benchmarks/local', { recursive: true })
  writeFileSync('benchmarks/local/typescript-operations-results.json', JSON.stringify({ kind: 'desktop-typescript-operations', node: process.version, results }, null, 2))
}, 120_000)
