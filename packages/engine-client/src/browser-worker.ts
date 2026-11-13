/**
 * Dedicated module worker entry for the browser engine. Bundled by
 * scripts/engine/web-worker-build.mjs into frontend/public/wasm/engine-worker.js,
 * next to the wasm-bindgen glue (lift_wasm.js) and lift_wasm_bg.wasm that
 * scripts/engine/wasm-build.mjs produces. Both are build output, not sources.
 */
import { installWorkerRuntime, type WasmFactory } from './worker-runtime'

interface WasmGlue {
  default(input?: { module_or_path: string | URL }): Promise<unknown>
  BrowserEngine: WasmFactory
}

const scope = globalThis as unknown as Pick<Worker, 'postMessage' | 'addEventListener'> & { location: { href: string } }
// Resolved at runtime beside this file, so the bundle never inlines the glue.
const glueUrl = new URL('./lift_wasm.js', scope.location.href).href
const wasmUrl = new URL('./lift_wasm_bg.wasm', scope.location.href)
const ready = (import(/* @vite-ignore */ /* webpackIgnore: true */ glueUrl) as Promise<WasmGlue>).then(async glue => {
  await glue.default({ module_or_path: wasmUrl })
  return glue.BrowserEngine
})
// Each request reports the failure; this only keeps it from going unhandled.
ready.catch(() => {})
installWorkerRuntime(scope, ready)
