/** Opt-in development bridge check. Uses cache-only synthetic data. */
import * as FileSystem from 'expo-file-system/legacy'
import {openNativeTransport,nativeExports} from '../../modules/lift-engine'
import {Asset} from 'expo-asset'

export async function runEngineSmoke():Promise<void>{
  if(!__DEV__)throw new Error('Engine smoke is development-only.')
  const token=Date.now()+'-'+Math.random().toString(36).slice(2)
  const directory=FileSystem.cacheDirectory+'engine-smoke-'+token+'/'
  await FileSystem.makeDirectoryAsync(directory,{intermediates:true})
  const path=directory+'engine.sqlite'
  const now='2026-01-01T12:00:00.000Z',today='2026-01-01'
  const first=await openNativeTransport('smoke-'+token,path,'synthetic',now)
  try{
    const command={op:'set_day_note',date:today,text:'native durable smoke'}
    const receipt=await first.transport.execute('one',first.generation,command,now,today)
    const retry=await first.transport.execute('one',first.generation,command,now,today)
    if(receipt.revision!==retry.revision)throw new Error('Duplicate command advanced revision.')
    const imported=await first.data.importFile({command_id:'import',generation:first.generation,revision:receipt.revision,format:'json',text:JSON.stringify({version:2,workouts:[],day_notes:[{date:'2026-01-02',text:'imported'}]}),replace:false,now,today})
    if(imported.revision!==receipt.revision+1)throw new Error('Import did not commit.')
    await first.data.saveRestorePoint(now)
    const points=await first.data.restorePoints()
    if(!points.current)throw new Error('Restore point not captured.')
    const bytes=await first.data.snapshotBytes(now)
    if(!(bytes instanceof Uint8Array)||bytes.byteLength===0)throw new Error('Snapshot did not cross Expo as binary bytes.')
    const state=await first.data.syncState()
    if(state.dirty!==true)throw new Error('Local edits not marked dirty.')
    const parsed=await first.data.parseAiPlan('```json\n{"days":[]}\n```')
    if(!parsed)throw new Error('AI response parser failed.')
    const exported=JSON.parse(await first.data.exportJson('synthetic',now))
    if(exported.version!==2)throw new Error('Rust user JSON export failed.')
    const legacy={schema_version:9,device_id:'legacy',exported_at:now,settings:{weight_unit:'lb',first_day_of_week:0},exercises:[],workouts:[],workout_exercises:[],sets:[],gyms:[],day_notes:[]}
    const legacyJson=JSON.parse(await nativeExports.json(legacy,'synthetic',now))
    if(legacyJson.version!==2)throw new Error('Legacy read-only JSON export failed.')
    const asset=Asset.fromModule(require('../../assets/fitnotes_skeleton.fitnotesdb'))
    if(!asset.localUri)await asset.downloadAsync()
    const b64=await FileSystem.readAsStringAsync(asset.localUri??asset.uri,{encoding:FileSystem.EncodingType.Base64})
    const skeleton=Uint8Array.from(atob(b64),c=>c.charCodeAt(0))
    const zip=await nativeExports.fitnotes(legacy,skeleton,now)
    if(!(zip instanceof Uint8Array)||zip[0]!==80||zip[1]!==75)throw new Error('Native SQLite/ZIP export failed.')
    const upload=await first.data.prepareUpload(now)
    if(!(upload.bytes instanceof Uint8Array)||upload.deviceId!=='synthetic')throw new Error('Upload binary metadata failed.')
    await first.data.acknowledgePush(upload.generation,upload.revision,upload.etag,'"smoke-upload"',now)
    if((await first.data.syncState()).dirty!==false)throw new Error('Push acknowledgement failed.')
    await first.data.replaceSnapshot(upload.bytes,upload.generation,upload.revision,'"smoke-remote"',now)
    const replaced=await first.transport.query({kind:'counts'})
    if(replaced.generation!==upload.generation+1)throw new Error('Replacement generation failed.')
  }finally{await first.transport.close()}
  const second=await openNativeTransport('reopened-'+token,path,'synthetic',now)
  try{
    const reply=await second.transport.query({kind:'day_note',date:today})
    if(reply.data!=='native durable smoke')throw new Error('Native data did not survive reopen.')
  }finally{await second.transport.close()}
  await FileSystem.deleteAsync(directory,{idempotent:true})
  console.info('[lift-engine-smoke] PASS: native commit, import, exports, AI parse, binary upload, acknowledgement, replacement, restore point, retry and reopen')
}
