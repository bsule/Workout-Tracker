import {spawnSync} from 'node:child_process'
import {cpSync,mkdirSync,readFileSync,copyFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
const platform=process.argv[2]
if(!['ios','android'].includes(platform))throw Error('Usage: node scripts/engine/prepare-native.mjs ios|android')
const modulePath=join(root,'mobile/modules/lift-engine')
function run(script,...args){const r=spawnSync(process.execPath,[script,...args],{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}
if(platform==='ios'){
  run('scripts/engine/ios-build.mjs')
  const output=join(modulePath,'ios/Generated');mkdirSync(output,{recursive:true})
  copyFileSync(join(root,'target/bindings/swift/LiftEngineRust.swift'),join(output,'LiftEngineRust.swift'))
  copyFileSync(join(root,'target/bindings/swift/LiftEngineFFI.h'),join(output,'LiftEngineFFI.h'))
  const artifact=JSON.parse(readFileSync(join(root,'target/ios-artifact.json'),'utf8'))
  cpSync(artifact.xcframework,join(output,'LiftEngineFFI.xcframework'),{recursive:true})
}else{
  run('scripts/engine/bindings.mjs','kotlin');run('scripts/engine/android-build.mjs')
  const output=join(modulePath,'android/generated');mkdirSync(output,{recursive:true})
  cpSync(join(root,'target/bindings/kotlin'),join(output,'java'),{recursive:true})
  // Copy only requested ABIs; a previous local build may have other libraries.
  for(const abi of (process.env.LIFT_ANDROID_ABIS??'arm64-v8a,x86_64').split(',')){
    cpSync(join(root,'target/android-jni',abi),join(output,'jniLibs',abi),{recursive:true})
  }
}
