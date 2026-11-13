import { build } from "esbuild"
import { fileURLToPath } from "node:url"

await build({
  entryPoints: [fileURLToPath(new URL("../frontend/lib/store/snapshot.worker.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../frontend/public/workers/snapshot.js", import.meta.url)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
})
