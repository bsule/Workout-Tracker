#!/usr/bin/env node
// Triggers the "Build iOS (unsigned IPA)" GitHub Actions workflow, waits for
// it to finish, and downloads the resulting unsigned .ipa into mobile/builds/.
// Requires the `gh` CLI to be installed and authenticated.

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(__dirname, "..");
const repoRoot = resolve(mobileDir, "..");
const outDir = resolve(mobileDir, "builds");
const WORKFLOW = "build-ios-unsigned.yml";

function gh(args, opts = {}) {
  const r = spawnSync("gh", args, { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || "");
    throw new Error(`gh ${args.join(" ")} exited ${r.status}`);
  }
  return r.stdout;
}

function ensureGh() {
  try { gh(["--version"]); } catch {
    console.error("gh CLI not found. Install: https://cli.github.com/");
    process.exit(1);
  }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  ensureGh();

  const before = JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--limit", "1", "--json", "databaseId"]));
  const beforeId = before[0]?.databaseId ?? 0;

  console.log("triggering workflow...");
  gh(["workflow", "run", WORKFLOW]);

  let runId = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const list = JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--limit", "1", "--json", "databaseId,status"]));
    if (list[0] && list[0].databaseId !== beforeId) { runId = list[0].databaseId; break; }
  }
  if (!runId) { console.error("couldn't find the newly triggered run"); process.exit(1); }
  console.log(`run id: ${runId}`);

  console.log("waiting for completion (this can take 10-20 min)...");
  spawnSync("gh", ["run", "watch", String(runId), "--exit-status"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".ipa")) unlinkSync(resolve(outDir, f));
  }
  console.log("downloading artifact...");
  gh(["run", "download", String(runId), "--name", "lift-unsigned-ipa", "--dir", outDir], { stdio: "inherit" });

  const ipa = readdirSync(outDir).filter((f) => f.endsWith(".ipa")).map((f) => resolve(outDir, f));
  console.log("done. files:");
  ipa.forEach((p) => console.log("  " + p));
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
