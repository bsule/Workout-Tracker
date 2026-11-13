import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {appendFileSync,readFileSync} from 'node:fs'
import {basename,join} from 'node:path'
import {pathToFileURL} from 'node:url'

// Hash actual build inputs, including names and modes so deletions/renames matter.
// New tracked mobile files are included automatically. Native folders generated
// by Expo and secrets are untracked and are never restored from an app cache.
export function mobileFingerprint(root, settings) {
  const hash=createHash('sha256').update('lift-mobile-v1\0').update(JSON.stringify(settings))
  const files=execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort()
  for(const entry of files){
    const [metadata,path]=entry.split('\t')
    if(['readme.md','agents.md','claude.md'].includes(basename(path).toLowerCase()))continue
    // Markdown inside the app/shared packages may be bundled product content.
    if(/\.md$/i.test(path)&&!path.includes('/'))continue
    if(path.includes('/')&&!/^(mobile|packages|crates|scripts|\.cargo|\.github)\//.test(path))continue
    hash.update('\0'+metadata.split(' ')[0]+'\0'+path+'\0').update(readFileSync(join(root,path)))
  }
  return hash.digest('hex')
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const settings={platform:process.env.BUILD_PLATFORM,configuration:process.env.BUILD_CONFIGURATION,architectures:process.env.BUILD_ARCHITECTURES,toolchain:process.env.BUILD_TOOLCHAIN}
  if(Object.values(settings).some(value=>!value))throw Error('Missing BUILD_* fingerprint settings')
  const fingerprint=mobileFingerprint(process.cwd(),settings)
  console.log(`Mobile build fingerprint: ${fingerprint}`)
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`fingerprint=${fingerprint}\n`)
}
