import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require=createRequire(import.meta.url)
const {BrowserEngine}=require('../../target/wasm-nodejs/lift_wasm.js')
const fixture=JSON.parse(readFileSync(new URL('../../tests/engine-parity/commands.json',import.meta.url)))
const engine=new BrowserEngine(JSON.stringify(fixture.initial),0,1,1001)
for(const [i,step]of fixture.steps.entries()){
  const id=`command-${i}`
  const pending=JSON.parse(engine.prepare(id,JSON.stringify(step.command),fixture.now,fixture.today))
  // Until the host durably commits, queries must still see the old revision.
  assert.equal(JSON.parse(engine.query('{"kind":"counts"}')).revision,i)
  assert.equal(pending.base_revision,i)
  assert.equal(JSON.parse(engine.publish(id)).revision,i+1)
  for (const {query,expected} of step.queries) assert.deepEqual(JSON.parse(engine.query(JSON.stringify(query))).data,expected)
}
const note=JSON.parse(engine.query('{"kind":"day_note","date":"2026-01-01"}'))
assert.equal(note.data,'')
engine.prepare('discard','{"op":"set_day_note","date":"2026-01-01","text":"discarded"}',fixture.now,fixture.today)
engine.discard('discard')
assert.equal(JSON.parse(engine.query('{"kind":"day_note","date":"2026-01-01"}')).data,'')
engine.free()
console.log('Actual WebAssembly command trace, commit visibility and discard passed')
