# Workout Tracker

Local-first workout tracker. Plan routines, log weight/reps per set, watch your estimated 1RM trend, import from / export to FitNotes. The web and mobile apps share a single TypeScript core and sync through a Cloudflare Worker.

## Layout

| Path          | What it is                                                                                                |
|---------------|-----------------------------------------------------------------------------------------------------------|
| `packages/core` | Shared store, sync, units, FitNotes import/export. Used by both `frontend` and `mobile`.                |
| `frontend`    | Next.js 16 + React 19 + Tailwind. Persists to IndexedDB.                                                  |
| `mobile`      | Expo / React Native. Persists to the app's filesystem sandbox; auto-backs-up to a user-picked Files folder. |
| `cloudflare`  | Hono Worker on Cloudflare. Auth in D1, snapshot blob in R2. Replaces the old Django backend.              |

## Run it locally

You'll typically want three terminals: the Worker, the web app, and the mobile app.

### 1. Cloudflare Worker (port 8787)

```bash
cd cloudflare
npm install
npm run db:apply:local   # apply migrations to local D1 simulator
npm run dev              # http://localhost:8787
```

See [cloudflare/README.md](cloudflare/README.md) for endpoints, deploy, and smoke tests.

### 2. Web (port 3215)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3215>.

### 3. Mobile

```bash
cd mobile
npm install
npm run start
```

Use the Expo dev client / Expo Go to load it on a device or simulator.

To build an unsigned iOS `.ipa` via GitHub Actions and download it into `mobile/builds/`:

```bash
cd mobile
npm run ipa:gh
```

To build an installable Android `.apk` via GitHub Actions and download it into `mobile/builds/`:

```bash
cd mobile
npm run apk:gh
```

Both require the `gh` CLI to be installed and authenticated; each build takes ~10–20 min. The iOS `.ipa` is unsigned — re-sign it with Sideloadly (or similar) and a free Apple ID before installing. The Android `.apk` is debug-signed and installs directly (`adb install <file>.apk`, or just open it on the device).

You can also build through EAS instead of GitHub Actions (`npm run build:ios` / `npm run build:android`, plus `:prod` variants).

## Configuration

Both clients default to `http://localhost:8787/api`. Override per-client:

- **Web** - `frontend/.env.local`: `NEXT_PUBLIC_API_BASE_URL=https://your-worker.example.com/api`
- **Mobile** - `mobile/app.json` → `expo.extra.apiBaseUrl`. On a real device, use your LAN IP, not `localhost`.

Worker CORS origins live in `cloudflare/wrangler.toml` under `ALLOWED_ORIGINS`.
