# Development

How to run the Worker, the web app, and the phone app locally, run the checks, and build or deploy. For how the code fits together, see [CLAUDE.md](../CLAUDE.md).

## Prerequisites

- **Node.js 22.13 or later, or 24.3 or later** (Expo SDK 58 needs one of these), and npm. CI builds on Node 24.
- **[`gh` CLI](https://cli.github.com/)**, signed in, if you want phone builds from GitHub Actions.
- **A Cloudflare account** only to run your own sync server (see [Run your own sync server](#run-your-own-sync-server)). Local dev runs on Wrangler's simulator and needs no account.
- **For the phone app:** a development build of the app on your phone (see [Phone app](#3-phone-app)), or Xcode / Android Studio to make one.

## Install

The repo is an npm workspace, so one install at the root covers every package:

```bash
npm install
```

| Folder          | Package name  |
|-----------------|---------------|
| `packages/core` | `@lift/core`  |
| `frontend`      | `lift-client` |
| `mobile`        | `lift-mobile` |
| `cloudflare`    | (worker)      |

Use the package name with `npm --workspace <name> run <script>` from the root, or `cd` into the folder and run the script there.

## Run it locally

Use three terminals: the Worker, the web app, and the phone app. `npm run dev` at the root starts the web and phone apps together.

### 1. Cloudflare Worker (port 8787)

```bash
cd cloudflare
npm run db:apply:local   # create the local D1 tables; run once, and again after a new migration
npm run dev              # http://localhost:8787
```

Local state lives in `cloudflare/.wrangler/` (gitignored). Delete it to start over with no accounts.

[cloudflare/README.md](../cloudflare/README.md) lists the endpoints and has curl commands for a quick smoke test.

### 2. Web app (port 3215)

```bash
npm run dev:web          # or: cd frontend && npm run dev
```

Open <http://localhost:3215>. The web app uses the local Worker by default. `npm run dev` and `npm run build` in `frontend/` automatically bundle the snapshot compression worker into `public/workers/snapshot.js` (gitignored). If you start Next directly, first run `node scripts/build-snapshot-worker.mjs` from the repo root. To point it somewhere else, create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-worker.example.com/api
```

The Worker only accepts requests from the origins in `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml`. `localhost:3215` and `localhost:3000` are already there.

### 3. Phone app

```bash
npm run dev:mobile       # or: cd mobile && npm run start
```

This starts Metro. The app uses its own native code (the rest timer module and the Live Activity widget), so load it in a **development build**, not Expo Go. Expo Go cannot open the Rust engine that owns workout data, so it cannot run the full app. To get a development build on your phone:

- `cd mobile && npx expo run:ios --device` (needs Xcode) or `npx expo run:android --device` (needs Android Studio), or
- `cd mobile && npx eas build --profile development --platform ios` (or `android`), then install the result.

**Which server it talks to:** `mobile/app.json` sets `expo.extra.apiBaseUrl` to the **production** Worker, so the phone app uses production even in dev. To use your local Worker, change it to `http://<your-computer's-LAN-IP>:8787/api`. `localhost` on a phone means the phone itself. Put it back before you commit.

**`expo prebuild` side effect:** running it locally rewrites the `ios` and `android` scripts in `mobile/package.json`. Revert that change. The generated `mobile/ios/` and `mobile/android/` folders are gitignored.

## Tests and checks

```bash
npm test                 # Vitest suite for @lift/core and some mobile/src logic (from the root)
npm run test:watch       # re-run on change
```

GitHub Actions runs the TypeScript, Rust, Wasm and Swift checks on pushes and pull requests. Run the relevant checks locally before merging. [tests/README.md](../tests/README.md) lists every suite.

Type and lint checks, per package:

```bash
cd frontend && npx tsc --noEmit    # the web app has no typecheck script
cd frontend && npm run lint
cd frontend && npm run build       # slowest; a final check
cd mobile && npm run typecheck
cd cloudflare && npm run typecheck
```

Tests cover core logic, engine clients, account switching, auth response ordering, snapshot worker encoding, local storage and the Worker's conditional write and bounded upload reader. Auth tests control React hooks and HTTP replies; they are not full rendered UI tests. Check web/phone interaction and the deployed Worker by running them.

For desktop performance diagnostics, run `npm run engine:baseline`, `cargo bench -p lift-engine --bench engine_bench`, `cargo bench -p lift-native --bench native_bench`, `cargo bench -p lift-native --bench operations_bench`, `cargo bench -p lift-native --bench stress_bench`, and `npm run engine:encoding-bench`. Raw samples go into ignored `benchmarks/local/`; methodology and measurements are in [scripts/engine/README.md](../scripts/engine/README.md).

## Phone builds

### GitHub Actions (no Apple or Google account needed)

`npm run ipa:gh` and `npm run apk:gh` (in `mobile/`) start a workflow in `.github/workflows/`, wait for it, and download the result into `mobile/builds/`. [install.md](install.md) has the steps for building and installing on a phone.

- **iOS** (`build-ios-unsigned.yml`) runs on a macOS 26 runner and picks the newest Xcode installed there, because the Expo native dependencies need Xcode 26 or later (Expo SDK 58 built with Xcode 26.6). It makes an unsigned Release `.ipa`.
- **Android** (`build-android-apk.yml`) runs on Ubuntu. The Release `.apk` is signed with the template's debug key, so it installs without any signing setup.

Both run `expo prebuild --clean` on the runner, so they don't depend on a local `ios/` or `android/` folder.

The workflows cache npm downloads, Rust compilation and finished app artifacts.
Android also caches Gradle dependencies/task outputs and enables configuration
caching. iOS caches CocoaPods downloads, Pods, Xcode build outputs and C/C++
compilation through ccache; it uses incremental `build` rather than `clean build`.
Expo/React Native already use precompiled iOS dependencies by default in this SDK.

An exact app-input fingerprint allows a docs-only edit to reuse a previously
successful binary without reinstalling dependencies or compiling. It includes
tracked mobile/shared/Rust/build-script files, root configuration and workflow
files, plus configuration, architectures and toolchain identity. Repository documentation and
README/agent instructions are excluded; Markdown bundled under mobile/shared
packages is still an app input. A cache miss always falls back to a normal build. Tests still run on
push independently; cache reuse does not replace them. Artifacts retain their
original binary contents/version, even when published by a newer docs-only run.

Workflow inputs:

- `force_rebuild`: bypass the finished-app cache to check real compilation; compiler
  and dependency caches remain enabled. Use this to compare cold and warm runs.
- Android `architectures`: defaults to `arm64-v8a,x86_64`, the two ABIs supplied by
  the Rust engine. Select `arm64-v8a` for modern physical phones or `x86_64` for
  compatible emulators. Both Rust and Gradle receive the same selection. The old
  template also built 32-bit ABIs without a Rust library, so those builds could
  not run the engine. They are no longer advertised in the APK.
- `runner`: defaults to the existing hosted runner. You can supply an available
  faster runner label. No paid runner is selected automatically. A custom runner
  needs the same prerequisites and sufficient disk/memory; iOS expects versioned
  Xcode installations under `/Applications`.

IPA CI prepares only the iOS device Rust library. Local native preparation still
builds device and simulator variants by default. Override with
`LIFT_IOS_TARGETS=aarch64-apple-ios-sim` for simulator-only work. Android preparation
accepts `LIFT_ANDROID_ABIS=arm64-v8a` (or `x86_64`); keep the Gradle
`-PreactNativeArchitectures` value in sync. Binding generation emits only the
platform's language when preparing mobile builds.

Concurrent builds with the same branch/configuration/architectures cancel the
older run. Already-compressed IPA/APK artifacts upload without an extra compression
pass. Android's release shrinker consumes the LiftEngine module's JNA keep rules,
including its documented desktop-AWT warning suppression; shrinking stays enabled.

See [build timing results](build-performance.md) for measurements and limitations.


### EAS

You can also build with Expo's EAS service. It needs an Expo account, and for iOS an Apple Developer account.

```bash
cd mobile
npm run build:ios              # preview profile, internal distribution
npm run build:android
npm run build:ios:prod         # production profile
npm run build:android:prod
npm run ipa                    # download the latest EAS iOS build into mobile/builds/
npm run ipa:pick               # choose which EAS build to download
```

The profiles are in `mobile/eas.json`.

## Run your own sync server

The app needs a sign-in, and sign-in goes through the Cloudflare Worker. `mobile/app.json` points at the repo owner's Worker. To run your own, deploy it to your own Cloudflare account. The Workers, D1, and R2 free tiers are enough for personal use. Cloudflare asks for a payment method before it turns on R2, even on the free tier.

You don't need an API key. Wrangler signs in through your browser.

1. Create a Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. Sign in from the terminal:

   ```bash
   cd cloudflare
   npx wrangler login
   ```

3. Create the database and the bucket:

   ```bash
   npx wrangler d1 create lift-auth
   npx wrangler r2 bucket create lift-snapshots
   ```

   `d1 create` prints a `database_id`. Replace the `database_id` in `cloudflare/wrangler.toml` with it.

4. Create the tables and deploy:

   ```bash
   npm run db:apply:remote
   npm run deploy
   ```

   Wrangler prints the Worker's URL, such as `https://lift-api.<your-subdomain>.workers.dev`.

5. Point the apps at it:
   - **Phone:** set `expo.extra.apiBaseUrl` in `mobile/app.json` to `<url>/api`. The GitHub Actions build reads `app.json` from the pushed commit, so commit and push this before you run `ipa:gh` or `apk:gh`.
   - **Web:** set `NEXT_PUBLIC_API_BASE_URL=<url>/api` wherever you host the web app, and add the web app's origin to `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml`, then run `npm run deploy` again. The phone app doesn't need this.

To deploy a change later, run `npm run db:apply:remote` (if you added a migration) and `npm run deploy`. Both act on production straight away. To deploy from CI instead of your own machine, create an API token in the Cloudflare dashboard and set it as `CLOUDFLARE_API_TOKEN`.

[cloudflare/README.md](../cloudflare/README.md) lists the endpoints and has curl commands to check a deploy.

## Where your data lives

- **Web:** in the browser, in OPFS, or IndexedDB when OPFS isn't available. Backup & Restore lists the previous save, a daily restore point, and an undo copy saved before replacing data from a file or the cloud. Recovery copies use IndexedDB and are scoped to your account. Clearing site data deletes all of these, so sync first. Only one tab edits data at a time: other tabs wait until the editor closes, then load the latest saved data. This requires a browser with Web Locks support.
- **Phone:** in the app's file sandbox, with local restore points (the last save and one about a day old) you can roll back to from Settings → Backup & Restore.
- **Cloud:** one snapshot per account in R2, written only when you sync. Each account can push 5 times per UTC day.
