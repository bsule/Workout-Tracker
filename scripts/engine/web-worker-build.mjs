// Bundle the browser engine worker from @lift/engine-client sources
// (browser-worker.ts, worker-runtime.ts, browser-storage.ts) into
// frontend/public/wasm/engine-worker.js. The Wasm glue and binary come from
// scripts/engine/wasm-build.mjs; everything in frontend/public/wasm is build
// output and gitignored.
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = join(root, 'frontend/public/wasm')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [join(root, 'packages/engine-client/src/browser-worker.ts')],
  outfile: join(out, 'engine-worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
})

const wasmDir = join(root, 'target/wasm-web')
for (const file of ['lift_wasm.js', 'lift_wasm_bg.wasm']) {
  const from = join(wasmDir, file)
  if (existsSync(from)) copyFileSync(from, join(out, file))
  else console.warn(`${file} not found in target/wasm-web; run scripts/engine/wasm-build.mjs first.`)
}
