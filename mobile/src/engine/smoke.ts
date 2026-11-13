/** Opt-in development bridge check. Uses cache-only synthetic data. */
import * as FileSystem from 'expo-file-system/legacy'
import {openNativeTransport} from '../../modules/lift-engine'

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
  }finally{await first.transport.close()}
  const second=await openNativeTransport('reopened-'+token,path,'synthetic',now)
  try{
    const reply=await second.transport.query({kind:'day_note',date:today})
    if(reply.data!=='native durable smoke')throw new Error('Native data did not survive reopen.')
  }finally{await second.transport.close()}
  await FileSystem.deleteAsync(directory,{idempotent:true})
  console.info('[lift-engine-smoke] PASS: native commit, retry, close and reopen')
}
