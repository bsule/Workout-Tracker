import { requireOptionalNativeModule } from 'expo-modules-core'

export interface EngineInfo {
  protocolVersion: number
  engineVersion: string
}
export interface WeightResult {
  kilograms: number
  pounds: number
  comparisonKey: number
}
interface NativeEngine {
  info(): Promise<EngineInfo>
  inspectWeight(kilograms: number | null): Promise<WeightResult>
}
const native = requireOptionalNativeModule<NativeEngine>('LiftEngine')

/** Explicit availability check; missing Rust must never silently select stale data. */
export async function engineInfo(): Promise<EngineInfo> {
  if (!native) throw new Error('Rust engine requires a development build with lift-engine included.')
  const info = await native.info()
  if (info.protocolVersion !== 1) throw new Error('Unsupported Rust engine protocol. Rebuild the app.')
  return info
}
export async function inspectWeight(kilograms: number | null): Promise<WeightResult> {
  await engineInfo()
  return native!.inspectWeight(kilograms)
}
