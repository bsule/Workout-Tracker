import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}
run(join(homedir(),'.cargo/bin/cargo'),['build','-p','lift-wasm','--target','wasm32-unknown-unknown','--release','--locked'])
for(const target of ['web','nodejs'])run(join(homedir(),'.cargo/bin/wasm-bindgen'),['target/wasm32-unknown-unknown/release/lift_wasm.wasm','--target',target,'--out-dir',`target/wasm-${target}`])
