import {spawnSync} from 'node:child_process'
import {mkdirSync,copyFileSync,existsSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
function run(command,args,env={}){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,...env}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}
const targets=(process.env.LIFT_IOS_TARGETS??'aarch64-apple-ios,aarch64-apple-ios-sim').split(',')
if(!targets.length||targets.some(target=>!['aarch64-apple-ios','aarch64-apple-ios-sim'].includes(target)))throw Error('Invalid LIFT_IOS_TARGETS')
run(process.execPath,['scripts/engine/bindings.mjs','swift'])
const cargo=(process.env.CARGO ?? 'cargo')
for(const target of targets)run(cargo,['build','-p','lift-native','--release','--locked','--target',target],{IPHONEOS_DEPLOYMENT_TARGET:'15.1'})
const headers=join(root,'target/ios-headers')
mkdirSync(headers,{recursive:true})
copyFileSync(join(root,'target/bindings/swift/LiftEngineFFI.h'),join(headers,'LiftEngineFFI.h'))
copyFileSync(join(root,'target/bindings/swift/LiftEngineFFI.modulemap'),join(headers,'module.modulemap'))
// Unique output per invocation avoids deleting a previous working artifact.
const output=join(root,`target/ios-build-${Date.now()}/LiftEngineFFI.xcframework`)
run('xcodebuild',['-create-xcframework',...targets.flatMap(target=>['-library',join(root,`target/${target}/release/liblift_native.a`),'-headers',headers]),'-output',output])
if(!existsSync(output))throw Error('XCFramework not produced')
console.log(`Rust iOS XCFramework: ${output}`)

writeFileSync(join(root,"target/ios-artifact.json"),JSON.stringify({xcframework:output})+"\n")
