# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **local-first workout tracker**. Plan routines, log weight/reps (or distance/time for cardio) per set, watch estimated 1RM trends, and import from / export to FitNotes. A web app and a mobile app share one TypeScript core and sync, on demand, through a Cloudflare Worker.

There is **no traditional backend/database for app data**. Each client owns the source of truth: the entire user dataset is a single in-memory `Snapshot` object, gzipped to a blob on local storage. The Cloudflare Worker only handles auth and stores an opaque snapshot blob per user for cross-device sync — it never parses workout data.

## Monorepo layout

npm workspaces (`packages/*`, `frontend`, `mobile`, `cloudflare`). The package names differ from the folder names — use the names when running workspace scripts:

| Folder       | Package name   | What it is |
|--------------|----------------|------------|
| `packages/core` | `@lift/core` | Shared store, sync, units, FitNotes import/export. The brain. Imported by both clients. |
| `frontend`   | `lift-client`  | Next.js 16 + React 19 + Tailwind 4. Persists to IndexedDB/OPFS. Dev port **3215**. |
| `mobile`     | `lift-mobile`  | Expo / React Native. Persists to the FS sandbox; auto-backs-up to a user-picked Files folder. |
| `cloudflare` | (worker)       | Hono Worker. Auth in D1 (`lift-auth`), snapshot blob in R2 (`lift-snapshots`). Dev port **8787**. |

Both clients default their API base to `http://localhost:8787/api`.

## Commands

Run from the repo root (workspace-aware) or from inside each folder.

```bash
# Web (frontend) — http://localhost:3215
npm run dev:web            # from root; or: cd frontend && npm run dev
cd frontend && npm run build
cd frontend && npm run lint        # eslint — the only configured lint

# Mobile
npm run dev:mobile         # from root; or: cd mobile && npm run start  (expo start)
cd mobile && npm run typecheck     # tsc --noEmit — there is no separate web typecheck script; use `npx tsc --noEmit`
cd mobile && npm run ipa:gh        # build unsigned iOS .ipa via GitHub Actions into mobile/builds/ (needs gh CLI, ~10-20 min)

# Cloudflare Worker — http://localhost:8787
cd cloudflare && npm run db:apply:local   # apply D1 migrations to the local simulator (run before first dev)
cd cloudflare && npm run dev
cd cloudflare && npm run db:apply:remote && npm run deploy   # production

# Both clients at once
npm run dev                # concurrently runs web + mobile
```

## Tests

A **Vitest** suite at the repo root covers `@lift/core` — the shared brain — directly through its public `exports` subpaths (no build step; Vitest transpiles the raw `.ts` on the fly). Run from the root:

```bash
npm test            # vitest run — one-shot, used in CI / before merging
npm run test:watch  # re-run on change
```

What's covered: units conversion, blob serialize/migrate (schema v1→4), indexes, materialize (Brzycki 1RM, durations), queries (fuzzy match, history, calendar), every mutation, the PR / position-PR computation, FitNotes CSV import (incl. the real fixture), JSON export↔import round-trips, crash-log replay in `persist`, and the `CloudflareTransport` wire protocol (mocked `fetch`). Tests live in `tests/`; shared store-reset and in-memory-storage helpers are in `tests/helpers/`.

The store is a module-level singleton — suites that touch it call `resetStore()` in `beforeEach` (see `tests/helpers/store.ts`), and import paths that flush inject an in-memory `BlobStorage` via `installMemoryStorage()`.

This suite tests the logic layer only. The two clients (React/React Native UI) and the Cloudflare Worker have **no automated tests** — "verifying" a UI or worker change still means running the app and exercising the flow, or curling the worker (see `cloudflare/README.md` for smoke-test curls).

**Import fixtures** (real FitNotes exports: `.fitnotesdb`, `.csv`) live in `test_dbs/` — these are sample databases the tests read from, not a test suite.

## Architecture — the core store

Everything important lives in `packages/core/src`. The two clients are thin shells around it. `frontend/lib/store/*` and `mobile/src/store/*` mostly **re-export** `@lift/core/store` (e.g. `frontend/lib/store/index.ts` is just `export * from "@lift/core/store"`).

### Data flow

`Snapshot` (`store/schema.ts`) is the whole dataset: `settings`, `exercises`, `workouts`, `workout_exercises`, `sets`, `gyms` — flat arrays of rows with numeric ids. It is the single in-memory state, held in `store/store.ts` (a hand-rolled external store consumed via `useStore`/`useSyncExternalStore`).

- **Mutations** (`store/mutations.ts`) take the snapshot and return a new one via `applyMutation`. Each mutation also appends an op line to a **crash log** (`recordPending`) and schedules a debounced flush.
- **Indexes** (`store/indexes.ts`) are rebuilt from the snapshot on every committed change; queries read indexes, not raw arrays.
- **Queries** (`store/queries.ts`) derive the view-model objects (`Workout`, `Exercise`, etc.) that components consume.
- **`localApi`** (`store/index.ts`) is the data-access surface components call. **It resolves synchronously against the in-memory snapshot but wraps results in `Promise.resolve(...)`** to keep call sites uniform with the old networked API. See the memory note: do not `await` between a `localApi` mutation and a navigation/commit — the await yields to React mid-flow and causes visible freezes.

### Persistence (`store/persist.ts`)

Local-first durability has two layers:
1. **Crash log** — every mutation appends one JSON op line immediately (`appendPending`). On boot, `hydrate()` reads the last good snapshot, replays any pending ops on top (`applyPendingOps` in persist.ts), then flushes a consolidated snapshot and clears the log.
2. **Snapshot flush** — a debounced (30s) `flushNow()` serializes the whole snapshot (`store/blob.ts`: `JSON.stringify` → gzip) and writes it. The 30s debounce is deliberate: gzipping mid-workout caused a visible ~5s UI freeze in the set-logger ticker. `flushOnHide()` forces a synchronous flush on app suspend (web `visibilitychange`/`pagehide`, RN `AppState`). Failed flushes retry with exponential backoff.

`runBatched()` pauses per-op crash-log appends for bulk work (e.g. large FitNotes imports) to avoid O(n²) log reads — caller must `flushNow()` after. `batchMutations()` defers index rebuild + re-render until the batch unwinds.

### Storage adapter injection

The core does **not** know how to persist. Hosts inject a `BlobStorage` factory via `setStorageFactory(...)` **before** `configureStore()`/`hydrateStore()`:
- Web: `frontend/lib/store/setupWebStore.ts` → IndexedDB/OPFS.
- Mobile: `mobile/src/store/bootstrap.ts` → `mobile/src/store/storage.ts` (`expo-file-system/legacy`).

`configureStore("users/<key>")` namespaces storage per signed-in user.

### Schema migrations

`store/schema.ts` has `SCHEMA_VERSION` (currently 4). On parse, `store/blob.ts:migrate()` upgrades older snapshots field-by-field. A migration that adds derived flags (e.g. v4's `is_position_pr`) triggers a full `recomputeAllPrs()` pass after hydrate. **When you change the snapshot shape, bump `SCHEMA_VERSION` and add a migration branch** — older clients/blobs in the wild will otherwise break.

### Sync (`store/../sync/`)

Manual, user-triggered (a Settings button), not background. `sync/autoSync.ts:syncNow()`:
1. Push the snapshot via `CloudflareTransport` (`PUT /api/sync/snapshot` with `If-Match`/`If-None-Match` etag).
2. `200` → done. `412` (stale etag) → return `{ kind: "stale" }` so the UI prompts: pull cloud vs. overwrite. `429` → `SyncQuotaExceededError` (server enforces a small daily push budget).

The R2 etag is an opaque version cookie; treat it as such. The blob the worker stores is byte-identical to the local snapshot — clients diff/merge by full replace, not field-level.

## Units convention

Canonical storage is **metric**: weight in **kg**, distance in **meters** (`distance_m`). The user's chosen display unit (`settings.weight_unit`: `"kg"|"lb"`, and per-set `distance_unit_display`) is preserved only for display and round-trip export. Convert at the UI boundary with `packages/core/src/units.ts` (`fromKg`/`toKg`/`formatWeight`). Never store display units as canonical.

## AI planning (BYO key)

Both clients have a parallel `ai/` layer (`frontend/lib/ai`, `mobile/src/ai`) — same structure on each side: `providers/` (anthropic, openai, gemini, deepseek), `buildContext.ts`, `prompts.ts`, `parse.ts`, `applyPlan.ts`. The user supplies their own API key (stored client-side). The model returns a structured plan that `applyPlan.ts` turns into workouts/sets via `localApi`. There is no server-side AI. When touching anything Claude/Anthropic-related here, consult the `claude-api` skill before editing.

## Gotchas

- The web app has **no `typecheck` npm script** — run `npx tsc --noEmit` in `frontend/` manually.
- `fflate`'s **synchronous** gzip API is used on purpose: the async variant spawns a Web Worker that doesn't exist in React Native.
- Mobile uses `expo-file-system/legacy` deliberately; don't "upgrade" it to the class-based `File`/`Directory` API without reason.
- The `.claude copy/` folder in the repo root is a stray copy, not part of the project.
