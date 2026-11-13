import {spawnSync} from 'node:child_process'
import {mkdirSync,copyFileSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {homedir} from 'node:os'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
const sdk=process.env.ANDROID_HOME??join(homedir(),'Library/Android/sdk')
const ndk=process.env.ANDROID_NDK_HOME??join(sdk,'ndk/27.1.12297006')
const host=process.platform==='darwin'?'darwin-x86_64':'linux-x86_64'
const bin=join(ndk,'toolchains/llvm/prebuilt',host,'bin')
if(!existsSync(bin))throw Error(`Missing NDK 27.1.12297006: ${bin}`)
function run(command,args,env={}){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,...env}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}
for(const [target,abi,clang]of [['aarch64-linux-android','arm64-v8a','aarch64-linux-android26-clang'],['x86_64-linux-android','x86_64','x86_64-linux-android26-clang']]){
  const suffix=target.replaceAll('-','_')
  const env={['CARGO_TARGET_'+suffix.toUpperCase()+'_LINKER']:join(bin,clang),['CC_'+suffix]:join(bin,clang),['AR_'+suffix]:join(bin,'llvm-ar')}
  run((process.env.CARGO ?? 'cargo'),['build','-p','lift-native','--release','--locked','--target',target],env)
  const output=join(root,'target/android-jni',abi);mkdirSync(output,{recursive:true})
  copyFileSync(join(root,`target/${target}/release/liblift_native.so`),join(output,'liblift_native.so'))
}
