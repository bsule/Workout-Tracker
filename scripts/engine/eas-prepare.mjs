import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const platform=process.env.EAS_BUILD_PLATFORM
if(!['ios','android'].includes(platform))throw Error('EAS_BUILD_PLATFORM must be ios or android')
const root=fileURLToPath(new URL('../../',import.meta.url))
const setup=spawnSync(process.execPath,['scripts/engine/ensure-toolchain.mjs',platform],{cwd:root,stdio:'inherit'})
if(setup.error)throw setup.error
if(setup.status!==0)process.exit(setup.status??1)
const result=spawnSync(process.execPath,['scripts/engine/prepare-native.mjs',platform],{cwd:root,stdio:'inherit'})
if(result.error)throw result.error
process.exit(result.status??1)
