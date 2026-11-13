import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url))
const cargo = process.env.CARGO ?? 'cargo'
function run(args) {
  const result = spawnSync(cargo, args, {cwd:root, stdio:'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['build', '-p', 'lift-native', '--features', 'bindgen', '--locked'])
const lib = process.platform === 'darwin' ? 'liblift_native.dylib' : 'liblift_native.so'
for (const language of ['swift', 'kotlin']) {
  const output = join(root, 'target/bindings', language)
  mkdirSync(output, {recursive:true})
  run(['run', '-p', 'lift-native', '--features', 'bindgen', '--bin', 'lift-bindgen', '--locked', '--', 'generate', '--library', join(root,'target/debug',lib), '--language',language,'--config',join(root,'crates/lift-native/uniffi.toml'),'--out-dir',output])
}
