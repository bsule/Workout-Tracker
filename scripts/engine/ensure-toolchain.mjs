import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {homedir} from 'node:os'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
const platform=process.argv[2]
if(!['ios','android'].includes(platform))throw Error('Specify ios or android')
const rustup=join(homedir(),'.cargo/bin/rustup')
function run(args){const r=spawnSync(rustup,args,{cwd:root,stdio:'inherit'});if(r.error)throw Error('Install rustup and retry: '+r.error.message);if(r.status!==0)process.exit(r.status??1)}
run(['show'])
run(['target','add',...(platform==='ios'?['aarch64-apple-ios','aarch64-apple-ios-sim']:['aarch64-linux-android','x86_64-linux-android'])])
