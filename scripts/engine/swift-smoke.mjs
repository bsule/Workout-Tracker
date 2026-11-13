import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
function run(command,args) {
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'})
  if(result.error) throw result.error
  if(result.status!==0) process.exit(result.status ?? 1)
}
run(process.execPath,['scripts/engine/bindings.mjs'])
// Swift executable entrypoint must be named main.swift.
copyFileSync(root+'scripts/engine/swift-smoke.swift',root+'target/bindings/swift/main.swift')
run('xcrun',['swiftc','target/bindings/swift/LiftEngineRust.swift','target/bindings/swift/main.swift','-Xcc','-fmodule-map-file=target/bindings/swift/LiftEngineFFI.modulemap','-I','target/bindings/swift','-L','target/debug','-llift_native','-Xlinker','-rpath','-Xlinker',root+'target/debug','-o','target/bindings/swift/smoke'])
run(root+'target/bindings/swift/smoke',[])
