# Development

How to run the Worker, the web app, and the phone app locally, run the checks, and build or deploy. For how the code fits together, see [CLAUDE.md](../CLAUDE.md).

## Prerequisites

- **Node.js 20 or later** and npm. CI builds on Node 20.
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

Open <http://localhost:3215>. The web app uses the local Worker by default. To point it somewhere else, create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-worker.example.com/api
```

The Worker only accepts requests from the origins in `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml`. `localhost:3215` and `localhost:3000` are already there.

### 3. Phone app

```bash
npm run dev:mobile       # or: cd mobile && npm run start
```

This starts Metro. The app uses its own native code (the rest timer module and the Live Activity widget), so load it in a **development build**, not Expo Go. In Expo Go the app runs, but the rest timer does nothing outside the app. To get a development build on your phone:

- `cd mobile && npx expo run:ios --device` (needs Xcode) or `npx expo run:android --device` (needs Android Studio), or
- `cd mobile && npx eas build --profile development --platform ios` (or `android`), then install the result.

**Which server it talks to:** `mobile/app.json` sets `expo.extra.apiBaseUrl` to the **production** Worker, so the phone app uses production even in dev. To use your local Worker, change it to `http://<your-computer's-LAN-IP>:8787/api`. `localhost` on a phone means the phone itself. Put it back before you commit.

**`expo prebuild` side effect:** running it locally rewrites the `ios` and `android` scripts in `mobile/package.json`. Revert that change. The generated `mobile/ios/` and `mobile/android/` folders are gitignored.

## Tests and checks

```bash
npm test                 # Vitest suite for @lift/core and some mobile/src logic (from the root)
npm run test:watch       # re-run on change
```

No CI runs the tests yet, so run them before you merge. [tests/README.md](../tests/README.md) lists every suite.

Type and lint checks, per package:

```bash
cd frontend && npx tsc --noEmit    # the web app has no typecheck script
cd frontend && npm run lint
cd frontend && npm run build       # slowest; a final check
cd mobile && npm run typecheck
cd cloudflare && npm run typecheck
```

The tests cover the shared core only. The web UI, the phone UI, and the Worker have no automated tests, so check those by running the app, or by curling the Worker.

## Phone builds

### GitHub Actions (no Apple or Google account needed)

`npm run ipa:gh` and `npm run apk:gh` (in `mobile/`) start a workflow in `.github/workflows/`, wait for it, and download the result into `mobile/builds/`. [install.md](install.md) has the steps for building and installing on a phone.

- **iOS** (`build-ios-unsigned.yml`) runs on a macOS 26 runner, because the Expo 57 native dependencies need Xcode 26. It makes an unsigned Release `.ipa`.
- **Android** (`build-android-apk.yml`) runs on Ubuntu. The Release `.apk` is signed with the template's debug key, so it installs without any signing setup.

Both run `expo prebuild --clean` on the runner, so they don't depend on a local `ios/` or `android/` folder.

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

- **Web:** in the browser, in OPFS, or IndexedDB when OPFS isn't available. Clearing site data deletes it, so sync first.
- **Phone:** in the app's file sandbox, with local restore points (the last save and one about a day old) you can roll back to from Settings → Backup & Restore.
- **Cloud:** one snapshot per account in R2, written only when you sync. Each account can push 5 times per UTC day.
