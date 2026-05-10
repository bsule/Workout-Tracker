#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(__dirname, "..");
const outDir = resolve(mobileDir, "builds");

const args = new Set(process.argv.slice(2));
const wantLatest = !args.has("--pick");
const profile = [...args].find((a) => a.startsWith("--profile="))?.split("=")[1];

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { cwd: mobileDir, encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited ${result.status}`);
  }
  return result.stdout;
}

function ensureEas() {
  try {
    run("eas", ["--version"]);
  } catch {
    console.error("eas CLI not found. Install with: npm i -g eas-cli");
    process.exit(1);
  }
}

function fetchBuilds() {
  const baseArgs = ["build:list", "--platform", "ios", "--status", "finished", "--limit", "10", "--json", "--non-interactive"];
  if (profile) baseArgs.push("--buildProfile", profile);
  const stdout = run("eas", baseArgs);
  const start = stdout.indexOf("[");
  const json = start >= 0 ? stdout.slice(start) : stdout;
  return JSON.parse(json);
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function pick(builds) {
  if (wantLatest) return builds[0];
  const { default: readline } = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  builds.forEach((b, i) => {
    const when = new Date(b.completedAt || b.createdAt).toLocaleString();
    console.log(`[${i}] ${b.appVersion} (${b.appBuildVersion}) · ${b.buildProfile} · ${when}`);
  });
  const answer = await rl.question("pick a build #: ");
  rl.close();
  return builds[Number(answer)] ?? builds[0];
}

async function main() {
  ensureEas();
  const builds = fetchBuilds();
  if (!builds.length) {
    console.error("No finished iOS builds found. Start one with: npm run build:ios");
    process.exit(1);
  }
  const build = await pick(builds);
  const url = build.artifacts?.buildUrl;
  if (!url) {
    console.error("Build has no artifact url:", build.id);
    process.exit(1);
  }
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const fileName = `lift-${build.appVersion}-${build.appBuildVersion}-${build.id.slice(0, 8)}.ipa`;
  const dest = resolve(outDir, fileName);
  console.log(`downloading ${build.appVersion} (${build.appBuildVersion}) -> ${dest}`);
  await downloadTo(url, dest);
  console.log("done.");
  console.log(dest);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
