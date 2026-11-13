import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {mobileFingerprint} from '../scripts/ci/mobile-fingerprint.mjs'

const roots:string[]=[]
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))
it('reuses docs-only edits while invalidating source, dependencies, configuration and tracked file changes',()=>{
  const root=mkdtempSync(join(tmpdir(),'lift-fingerprint-'));roots.push(root)
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root})
  git('init','--quiet')
  for(const directory of ['mobile','packages','crates','scripts/ci','.github/workflows'])mkdirSync(join(root,directory),{recursive:true})
  const put=(path:string,value:string)=>writeFileSync(join(root,path),value)
  put('README.md','old docs');put('mobile/app.ts','app');put('packages/core.ts','core');put('crates/lib.rs','rust');put('package-lock.json','lock');put('.github/workflows/build.yml','workflow')
  git('add','.')
  const settings={platform:'ios',configuration:'Release',architectures:'arm64',toolchain:'xcode-26'}
  const fingerprint=()=>mobileFingerprint(root,settings)
  const original=fingerprint()
  put('README.md','new docs');expect(fingerprint()).toBe(original)
  put('mobile/help.md','bundled help');git('add','.');expect(fingerprint()).not.toBe(original)
  git('rm','--cached','mobile/help.md');expect(fingerprint()).toBe(original)
  for(const path of ['mobile/app.ts','packages/core.ts','crates/lib.rs','package-lock.json','.github/workflows/build.yml']){
    put(path,readOriginal(path)+' changed');expect(fingerprint()).not.toBe(original);put(path,readOriginal(path))
  }
  expect(mobileFingerprint(root,{...settings,configuration:'Debug'})).not.toBe(original)
  expect(mobileFingerprint(root,{...settings,architectures:'simulator'})).not.toBe(original)
  expect(mobileFingerprint(root,{...settings,toolchain:'xcode-27'})).not.toBe(original)
  put('mobile/new.ts','new');git('add','.');expect(fingerprint()).not.toBe(original)
  git('rm','--cached','mobile/new.ts');expect(fingerprint()).toBe(original)
  git('rm','--cached','mobile/app.ts');expect(fingerprint()).not.toBe(original)
})
function readOriginal(path:string){return ({'mobile/app.ts':'app','packages/core.ts':'core','crates/lib.rs':'rust','package-lock.json':'lock','.github/workflows/build.yml':'workflow'} as Record<string,string>)[path]}
