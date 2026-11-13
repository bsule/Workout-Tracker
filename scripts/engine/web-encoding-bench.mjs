// Desktop Node event-loop diagnostic for the exact browser worker bundle.
// Structured-clone and scheduling costs are host-specific; this is not a
// real-browser/phone frame-rate measurement. Never opens an account store.
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { gzipSync, gunzipSync } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const built = await build({ entryPoints: [fileURLToPath(new URL('frontend/lib/store/snapshot.worker.ts', root))], bundle: true, format: 'iife', platform: 'browser', write: false })
const worker = new Worker(`const {parentPort}=require('node:worker_threads');
globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
parentPort.on('message',data=>globalThis.onmessage({data}));
${built.outputFiles[0].text}`, { eval: true })
let sequence = 0
const waiting = new Map()
worker.on('message', message => {
  const request = waiting.get(message.id)
  waiting.delete(message.id)
  if (message.error) request.reject(new Error(message.error))
  else request.resolve(message.bytes)
})
worker.on('error', error => { for (const request of waiting.values()) request.reject(error); waiting.clear() })
function encode(snapshot) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    waiting.set(id, { resolve, reject })
    worker.postMessage({ id, snapshot })
  })
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function measure(operation) {
  let last = performance.now(), maxLag = 0
  const ticker = setInterval(() => {
    const now = performance.now()
    maxLag = Math.max(maxLag, now - last - 2)
    last = now
  }, 2)
  await pause(10)
  const start = performance.now()
  const bytes = await operation()
  const elapsedMs = performance.now() - start
  await pause(10)
  clearInterval(ticker)
  return { bytes, elapsedMs, maxEventLoopLagMs: maxLag }
}
function snapshot(count) {
  const result = { schema_version: 9, exported_at: '2026-11-12T12:00:00.000Z', device_id: 'synthetic', settings: { weight_unit: 'lb', first_day_of_week: 0 }, exercises: [], workouts: [], workout_exercises: [], sets: [], gyms: [], day_notes: [] }
  result.exercises = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Synthetic ${i}`, category: 'chest', kind: 'weight_reps', is_custom: true }))
  for (let i = 0; i < count / 10; i++) {
    const date = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10)
    const created_at = date + 'T08:00:00.000Z'
    result.workouts.push({ id: 100 + i, date, status: 'done', started_at: null, finished_at: null, gym: '', notes: '', created_at })
    result.workout_exercises.push({ id: 100_000 + i, workout_id: 100 + i, exercise_id: i % 10 + 1, order: 0, note: '' })
    for (let j = 0; j < 10; j++) result.sets.push({ id: 1_000_000 + i * 10 + j, workout_exercise_id: 100_000 + i, weight: 40 + i % 80, reps: 5 + j, distance_m: null, distance_unit_display: '', time_seconds: null, is_planned: false, is_pr: false, was_pr: false, is_position_pr: false, was_position_pr: false, note: '', order: j, created_at })
  }
  return result
}
const results = []
try {
  for (const sets of [10_000, 100_000, 250_000]) {
    const data = snapshot(sets)
    const sync = () => gzipSync(new TextEncoder().encode(JSON.stringify(data)))
    // Warm both paths before the recorded samples.
    sync(); await encode(data)
    for (let sample = 0; sample < 5; sample++) {
      const main = await measure(sync)
      const background = await measure(() => encode(data))
      // Gzip's timestamp header can differ across seconds. Compare the exact
      // decompressed bytes rather than treating a different mtime as damage.
      if (!Buffer.from(gunzipSync(main.bytes)).equals(Buffer.from(gunzipSync(background.bytes)))) throw new Error('Worker format differs from synchronous encoder')
      results.push({ sets, sample, snapshotBytes: main.bytes.length, main: { elapsedMs: main.elapsedMs, maxEventLoopLagMs: main.maxEventLoopLagMs }, worker: { elapsedMs: background.elapsedMs, maxEventLoopLagMs: background.maxEventLoopLagMs } })
    }
    console.log(`Completed ${sets} sets (main thread and worker, 5 samples each)`)
  }
} finally { await worker.terminate() }
const directory = new URL('benchmarks/local/', root)
mkdirSync(directory, { recursive: true })
writeFileSync(new URL('web-encoding-results.json', directory), JSON.stringify({ kind: 'desktop-node-event-loop', node: process.version, results }, null, 2))
