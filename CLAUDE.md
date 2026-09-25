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
| `mobile`     | `lift-mobile`  | Expo / React Native. Persists to the FS sandbox, with three rotating snapshot files as local restore points. |
| `cloudflare` | (worker)       | Hono Worker. Auth in D1 (`lift-auth`), snapshot blob in R2 (`lift-snapshots`). Dev port **8787**. |

Both clients fall back to `http://localhost:8787/api` in code. Mobile overrides it: `mobile/app.json` `extra.apiBaseUrl` points at the production worker (`lift-api.bilal-suleiman.workers.dev`), so a mobile build talks to production unless you change that value (for example to your LAN IP) for local dev.

## Commands

Run from the repo root (workspace-aware) or from inside each folder.

```bash
# Web (frontend) — http://localhost:3215
npm run dev:web            # from root; or: cd frontend && npm run dev
cd frontend && npm run build
cd frontend && npm run lint        # eslint — the only configured lint
cd frontend && npx tsc --noEmit    # frontend has NO typecheck script — run tsc directly

# Mobile
npm run dev:mobile         # from root; or: cd mobile && npm run start  (expo start)
cd mobile && npm run typecheck     # tsc --noEmit
cd mobile && npm run ipa:gh        # build unsigned iOS .ipa via GitHub Actions into mobile/builds/ (needs gh CLI, ~10-20 min)
cd mobile && npm run apk:gh        # same, Android .apk

# Cloudflare Worker — http://localhost:8787
cd cloudflare && npm run db:apply:local   # apply D1 migrations to the local simulator (run before first dev)
cd cloudflare && npm run dev
cd cloudflare && npm run typecheck        # tsc --noEmit
cd cloudflare && npm run db:apply:remote && npm run deploy   # production

# Both clients at once
npm run dev                # concurrently runs web + mobile
```

## Tests

A **Vitest** suite at the repo root covers `@lift/core` — the shared brain — directly through its public `exports` subpaths (no build step; Vitest transpiles the raw `.ts` on the fly). Run from the root:

```bash
npm test            # vitest run, one-shot; CI runs it on every push and PR (.github/workflows/test.yml)
npm run test:watch  # re-run on change
```

What's covered: units conversion, blob serialize/migrate (schema v1→8), indexes, materialize (Brzycki 1RM, durations), queries (fuzzy match, history, calendar, day notes), top-weight records, every mutation, the PR / position-PR computation, FitNotes CSV import (synthetic fixture), JSON export↔import round-trips, crash-log replay in `persist`, the device-local sync clock, the `CloudflareTransport` wire protocol (mocked `fetch`), demo-data seeding, the helpers lifted out of the mobile screens (`sharedHelpers`, `setLogger`, `exerciseStats`, `categoryStyles`, `monthPaging`, `sameHistory`, `predictPrFlags`), the account-store move on both clients (`accountStore` for mobile, `webStorageMove` for the IndexedDB and OPFS adapters, on `fake-indexeddb` and an in-memory OPFS), and suites that import from `mobile/src` (`swipeHold`, `restTimerPlan`, `restTimerController`, `snapshotRotation`, `restorePoints`, `signOut`). `tests/README.md` lists every suite. Tests live in `tests/`; shared store-reset and in-memory-storage helpers are in `tests/helpers/`.

The store is a module-level singleton — suites that touch it call `resetStore()` in `beforeEach` (see `tests/helpers/store.ts`), and import paths that flush inject an in-memory `BlobStorage` via `installMemoryStorage()`.

This suite tests the logic layer only. The two clients (React/React Native UI) and the Cloudflare Worker have **no automated tests** — "verifying" a UI or worker change still means running the app and exercising the flow, or curling the worker (see `cloudflare/README.md` for smoke-test curls).

**Import fixtures:** the FitNotes CSV used by the suite lives in `tests/fixtures/`. Optional local sample DBs/exports go in `test_dbs/` (gitignored, not a test suite).

## Architecture — the core store

Everything important lives in `packages/core/src`. The two clients are thin shells around it. `frontend/lib/store/*` mostly **re-exports** `@lift/core/store` (e.g. `frontend/lib/store/index.ts` is just `export * from "@lift/core/store"`). Mobile imports `@lift/core` directly; `mobile/src/store/` holds only the storage adapter, the bootstrap, and the provider.

### Data flow

`Snapshot` (`store/schema.ts`) is the whole dataset: `settings`, `exercises`, `workouts`, `workout_exercises`, `sets`, `gyms`, `day_notes`. Most tables are flat arrays of rows with numeric ids; `day_notes` is `{ date, text }` keyed by calendar date and is independent of workouts (empty/whitespace `setDayNote` deletes the row). There are four note kinds and they are separate: `day_notes` (per date, outlives the workout), `workout.notes` (per session, dies with the workout), `workout_exercise.note` (one exercise on one day), and `set.note` (per set). It is the single in-memory state, held in `store/store.ts` (a hand-rolled external store consumed via `useStore`/`useSyncExternalStore`).

- **Mutations** (`store/mutations.ts`) take the snapshot and return a new one via `applyMutation`. Each mutation also appends an op line to a **crash log** (`recordPending`) and schedules a debounced flush.
- **PR computation** (`store/prs.ts`) is deliberately separate from mutations so `persist.ts` can reuse it when replaying the crash log without creating a `persist ↔ mutations` import cycle. Pure snapshot→snapshot: `recomputePrsForWe`, `recomputePrsForExercise`, `recomputePrsForExercises`. **Every path that adds, edits, or removes a set must run one of these** — live mutation, crash-log replay, import, migration — or the `is_pr` / `is_position_pr` flags stored on the rows go stale.
- **Indexes** (`store/indexes.ts`) are rebuilt from the snapshot on every committed change; queries read indexes, not raw arrays.
- **Queries** (`store/queries.ts`) derive the view-model objects (`Workout`, `Exercise`, etc.) that components consume.
- **Records** (`store/records.ts`) derive top-weight-per-rep records from an `ExerciseHistoryDay[]`. They are pure functions with no store access, which is why they sit apart from `queries.ts` (that file reaches into `getState()`).
- **`localApi`** (`store/index.ts`) is the data-access surface components call. **It resolves synchronously against the in-memory snapshot but wraps results in `Promise.resolve(...)`** to keep call sites uniform with the old networked API. See the memory note: do not `await` between a `localApi` mutation and a navigation/commit — the await yields to React mid-flow and causes visible freezes.

### Persistence (`store/persist.ts`)

Local-first durability has two layers:
1. **Crash log** — every mutation appends one JSON op line immediately (`appendPending`). On boot, `hydrate()` reads the last good snapshot, replays any pending ops on top (`applyPendingOps` in persist.ts), then flushes a consolidated snapshot and clears the log.
2. **Snapshot flush** — a debounced (30s) `flushNow()` serializes the whole snapshot (`store/blob.ts`: `JSON.stringify` → gzip) and writes it. The 30s debounce is deliberate: gzipping mid-workout caused a visible ~5s UI freeze in the set-logger ticker. `flushOnHide()` forces a synchronous flush on app suspend (web `visibilitychange`/`pagehide`, RN `AppState`). Failed flushes retry with exponential backoff. `flushNow()` returns the in-flight promise to a caller that arrives mid-flush instead of silently no-oping, and re-flushes once more if edits landed while the disk write was in progress, so a "wait for the save" caller (a restore, a user switch) never resolves before its own edits are actually on disk.

**Mobile restore points** (`mobile/src/store/storage.ts`, `snapshotRotation.ts`, `restorePoints.ts`). Each write rotates `snapshot.bin` → `.bak`, and moves `.bak` → `.bak2` only once `.bak2` is 24 hours old, so `.bak2` stays a day-old way back from a mistake. `restore-points.json` holds each file's time and counts, from the `SnapshotStats` that `flushNow()` and `replaceSnapshotFromBytes()` pass to `writeSnapshot`. A restore (Settings → Backup & Restore, which also holds cloud sync; Import / Export has only files) first writes the in-memory data to `.undo`, then holds the daily slot so its own write does not push a fresh file into `.bak2`. The store loads only for a signed-in user, so there is no `users/anon` store. Older builds left an empty one on disk; nothing reads it.

`configure()` to a different sub-path unloads the store (`markUnhydrated`) until the new hydrate lands, so a flush or auto sync in between cannot write or push the outgoing user's data under the incoming user. On boot, `hydrate()` tries each copy from the adapter's optional `snapshotCandidates()` (mobile: `.bin`, `.bak`, `.bak2`) until one parses; if none does, it throws instead of silently starting fresh, so a corrupt device does not quietly present an empty account. It moves the damaged ones aside (`discardSnapshotCopies`, mobile: `*.corrupt`) and writes the fallback copy straight back as current. A copy from a newer schema (`SnapshotTooNewError`) is not damage: hydrate rejects and writes nothing, and mobile shows an "update the app" message. The web adapters keep one copy and do not implement `snapshotCandidates()`. A second restore with no edits in between keeps the undo copy. Both clients call `unloadStore()` (save, then drop from memory) on sign-out: mobile in `unloadForSignOut` (`bootstrap.ts`), which also ends the rest timer, and web in `logout` (`frontend/components/auth/AuthProvider.tsx`). The web `StoreProvider` also unloads the outgoing user before it configures and hydrates a different one. `replaceSnapshotFromBytes()` (cloud pull, restore) blocks flushes while it runs: a flush that wrote the outgoing snapshot after it would undo it on disk. A restore or replace also re-checks, after every `await`, that the store is still on the same storage/account it started on, and throws rather than write if it changed underneath it — the user switching accounts mid-restore must not finish writing into the new account.

`runBatched()` pauses per-op crash-log appends for bulk work (e.g. large FitNotes imports) to avoid O(n²) log reads — caller must `flushNow()` after. `batchMutations()` defers index rebuild + re-render until the batch unwinds.

### Storage adapter injection

The core does **not** know how to persist. Hosts inject a `BlobStorage` factory via `setStorageFactory(...)` **before** `configureStore()`/`hydrateStore()`:
- Web: `frontend/lib/store/setupWebStore.ts` → IndexedDB/OPFS.
- Mobile: `mobile/src/store/bootstrap.ts` → `mobile/src/store/storage.ts` (`expo-file-system/legacy`).

`configureStore(accountStorePath(user.id))` (`accounts/<id>`, from `@lift/core/store/paths`) namespaces storage per signed-in user. It is keyed by the server's user id, never the username: a rename in Settings must keep the same store. Builds before this kept it under `users/<username>`; on an account's first load each client moves that store to the id path once (mobile `adoptLegacyStore`, one folder rename; web `adoptLegacyWebStore`, OPFS copy then delete or one IndexedDB transaction) and never overwrites an existing account store. A failed move rejects the load rather than showing an empty store.

### Schema migrations

`store/schema.ts` has `SCHEMA_VERSION` (currently 8). On parse, `store/blob.ts:migrate()` upgrades older snapshots field-by-field. Any schema upgrade (`parsed.migrated` in `persist.ts`) makes hydrate run a full `recomputeAllPrs()` pass, which is how derived flags such as v4's `is_position_pr` get filled in. v5 copies non-empty `workout.notes` into `day_notes`, then blanks leftover `workout.notes` so a deleted day note cannot resurrect on export. v6 makes `workout.notes` canonical again as a per-session note; it blanks leftovers on the v5→v6 hop only (under v5 the field was dead, so any value on a v5 row is garbage). v7 adds `workout_exercise.note` and backfills it empty — new storage, nothing to lift from an older field. v8 changes no field at all: PR comparison moved from raw kg floats to `units.ts`'s `weightKey`, so every flag computed under the old rule is stale. The bump exists only to make hydrate run `recomputeAllPrs()`, so v8 has no branch in `migrate()`. **The blanking pass must never run on a current-version snapshot** — it would delete every workout note on the next boot. `tests/blob.test.ts` guards this. **When you change the snapshot shape, bump `SCHEMA_VERSION` and add a migration branch** — older clients/blobs in the wild will otherwise break.

### Sync (`store/../sync/`)

Mostly manual. The user triggers a round-trip from a Settings button. `sync/autoSync.ts:syncNow()`:
1. Push the snapshot via `CloudflareTransport` (`PUT /api/sync/snapshot` with `If-Match`/`If-None-Match` etag).
2. `200` → done. `412` (stale etag) → return `{ kind: "stale" }` so the UI prompts: pull cloud vs. overwrite. `429` → `SyncQuotaExceededError` (the server enforces 5 pushes per UTC day; `fetchQuota()` reads the remaining count from `GET /api/sync/quota`, and pulls and quota reads are free).

`sync/syncClock.ts` holds the device-local sync state: `lastSyncedAt`, plus the etag of a cloud version that is ahead and whether the user has already been told about it. It is deliberately **not** part of the `Snapshot`, because `serialize()` re-stamps `exported_at` on every push, so a timestamp inside the snapshot would dirty it forever. Hosts inject a `SyncClockStore` via `configureSyncClock(...)`, the same pattern as `BlobStorage`. Until a host injects one, reads are empty and writes do nothing. Every path that leaves local and cloud in agreement calls `markSynced()`.

That one clock drives two things: the "last synced" label, and `maybeAutoSync()`. The latter is the only non-manual path. Web calls it after hydrate, deferred to idle (`frontend/components/store/StoreProvider.tsx`). Mobile calls it after hydrate and again every time the app returns to the foreground (`mobile/src/store/bootstrap.ts`). It pushes when the last sync is over a day old, and it waits 6 hours before retrying a failed attempt. It skips outright when the store is not hydrated, when the snapshot has no workouts, when this device has never synced, or when a conflict is open — an automatic push must never overwrite the cloud copy with nothing. `markCloudNewer()` records a `412` so the app asks once per distinct cloud etag and never nags twice about the same one. `previewRemote()` (the conflict dialog and restore screens read the cloud copy to show its date and counts) puts the device's etag back after its pull: only looking must not count as syncing, or the next Sync now would overwrite the newer cloud copy. `applyRemoteBytes()` adopts the previewed etag when the user takes that copy.

The R2 etag is an opaque version cookie; treat it as such. The blob the worker stores is byte-identical to the local snapshot — clients diff/merge by full replace, not field-level.

## Units convention

Canonical storage is **metric**: weight in **kg**, distance in **meters** (`distance_m`). The user's chosen display unit (`settings.weight_unit`: `"kg"|"lb"`, and per-set `distance_unit_display`) is preserved only for display and round-trip export. Convert at the UI boundary with `packages/core/src/units.ts` (`fromKg`/`toKg`/`formatWeight`). Never store display units as canonical.

## AI planning (BYO key)

The AI layer lives once in core, `packages/core/src/ai` (`@lift/core/ai`): `providers/` (anthropic, openai, gemini, deepseek), `buildContext.ts`, `prompts.ts`, `parse.ts`, `applyPlan.ts`. `frontend/lib/ai/index.ts` and `mobile/src/ai/index.ts` re-export it; only `keys.ts` stays per client (web `localStorage`, mobile `expo-secure-store`). The web build sends `anthropic-dangerous-direct-browser-access` through `createProviderLookup({ anthropic: { directBrowserAccess: true } })`; mobile uses the default lookup without it. The user supplies their own API key (stored client-side). The model returns a structured plan that `applyPlan.ts` turns into workouts/sets via `localApi`. There is no server-side AI. When touching anything Claude/Anthropic-related here, consult the `claude-api` skill before editing.

## Gotchas

- The web app has **no `typecheck` npm script** — run `npx tsc --noEmit` in `frontend/` manually.
- `fflate`'s **synchronous** gzip API is used on purpose: the async variant spawns a Web Worker that doesn't exist in React Native.
- Mobile uses `expo-file-system/legacy` deliberately; don't "upgrade" it to the class-based `File`/`Directory` API without reason.
- Day notes live in `day_notes` (`getDayNote` / `setDayNote`; crash-log op `set_day_note`). Workout notes live in `workout.notes` (`setWorkoutNote`, which delegates to `patchWorkout`; crash-log op `patch_workout`). Note-only days are not calendar markers. JSON export is `version: 2`: `workouts[].notes` carries the session note and `day_notes[]` carries the day note. A `version: 1` payload put the day note on `workouts[].notes`, so the importer branches on the version. Exercise notes live in `workout_exercise.note` (`setExerciseNote`; crash-log op `set_exercise_note`) and are not copied by `copyFromWorkout` — the note describes a session the target day has not had yet. FitNotes CSV and `.fitnotesdb` have one Notes field per day, so `combinedNoteFor()` joins the day and session notes into it; there is no FitNotes field for an exercise note, so it is JSON-export only.
- The empty-workout cleanup guards (`!rawWorkout.notes` in `DayView.tsx` and `DayScreen.tsx`, `!w.notes` in the two set-logger screens) keep a note-only workout alive on purpose. Do not drop the `notes` check from them.
- Mobile popups use `usePresence` (`mobile/src/anim/index.ts`) for the fade and `OverlayCard` (`mobile/src/components/OverlayCard.tsx`) for the backdrop and card. Defer store mutations past the fade with `deferPastAnimation`. The `mobile-popups-no-flicker` skill has the rules. Dropdown and overflow menus go through `MenuButton` / `MenuPopup`, which show the system `Alert.alert` (a UIMenu opened from the nav bar covers its own button on iOS 26). `react-native-modal` is still a dependency, but only `ExercisePickerSheet` uses it.
- Rest timer outside the app: saving a set in `SetLoggerScreen` calls `restTimer.setLogged()` (`mobile/src/restTimer/`), which drives the native module `mobile/modules/rest-timer` (iOS ActivityKit Live Activity, Android ongoing notification with a chronometer). The Live Activity's SwiftUI views live in `mobile/targets/rest-timer/`, which `@bacons/apple-targets` turns into a widget extension on every `expo prebuild`. `RestTimerAttributes.swift` exists twice (module and target) and must stay byte-identical; `tests/restTimerPlan.test.ts` guards it. Settings are `rest_timer_activity` and `rest_timer_cutoff_s` in `Snapshot.settings` (optional keys, no schema bump). iOS cannot end the activity while the app is suspended, so `restTimer.reconcile()` runs after hydrate and on every foreground. Running `expo prebuild` locally also rewrites the `ios`/`android` scripts in `mobile/package.json`; revert that. Tapping the "since last set" line in the set logger (`RestTicker`, `mobile/src/components/RestTicker.tsx`) opens Reset timer / Stop timer. Reset restarts the count and the Live Activity from now without logging a set; Stop ends the Live Activity and hides the line. The set logger keeps `RestTicker` mounted and the line hides itself, so any lost anchor (a deleted set, the 30 minute cutoff) shuts it with the same collapse as Stop instead of dropping it in one frame. Neither is a set or touches the `Snapshot`: `restTimer.reset()` / `stop()` record an in-memory mark tagged with the workout date, and `tickerAnchor` in `restTimer/plan.ts` applies it only on that date's workout (a reset today must not start a count on an old workout) and lets the next saved set take over again. Sign-out calls `clearMark()`, and a relaunch forgets the mark. The web set logger has its own `RestTicker` (`frontend/components/workouts/RestTicker.tsx`) with no native side: Reset and dismiss are component state, and nothing survives leaving the page. Both clients read the same `show_time_since_last_set` and `show_last_time` keys in `Snapshot.settings` (optional, default on), so toggling the ticker or the last-time card on one device carries to the other after a sync.
- Mobile light mode: `StyleSheet.create` captures `theme.colors` at module load, and `App.tsx` swaps in the stored palette only after its imports run. Anything `App.tsx` imports eagerly (including through `StoreProvider`) builds its styles in the dark palette, which is why `App.tsx` lazy-loads `RootNavigator` and `StoreProvider` lazy-loads `RestoreBackupScreen`. A new screen or component reached from those providers must be lazy too. Do not hardcode `rgba(255,255,255,…)`: use `tint()` / `line()` from `mobile/src/theme/theme.ts`, or a token (`border`, `pr`, `prText`, `prHistorical`, `gold`). Dark mode is the reference: a light-mode fix must leave every dark value unchanged.
- One workout per date: `createWorkout`, the date index, and both importers assume it. The JSON importer matches a file workout to that day's workout whatever its gym; same date and gym is the same session (sets dedupe by position), anything else joining a day's workout goes after its sets, skipping ones the device already has with the same values, so re-importing a file adds nothing. Gym names are one gym in any case: `createGym` returns the saved one, `patchWorkout` and the JSON import store the saved spelling, `renameGym` refuses another gym's name in any case and rewrites every spelling of its own (`store/gymRules.ts`, shared with the crash-log replay of `rename_gym`), and both Gyms screens check `gymAddError`. `dedupeGyms` (`store/repair.ts`) drops exact-name duplicate gym rows on every load.
- Importers resolve exercise names through `ExerciseLookup` (`packages/core/src/import/exerciseNames.ts`): names are compared after `normalizeExerciseName` (NFC, collapsed spaces, any case), deleted rows never match, and a built-in matches only if the file states the same kind or none (a time-only "Plank" gets its own custom row). The set logger passes the tap time as `created_at` to `addSet` / `logPlannedSet`, so the row, the in-app ticker and the Live Activity share one anchor.
- Mobile Settings is a hub. Preferences live on sub-pages in `mobile/src/screens/settings/` (General, Set logger, Rest timer), built from the rows in `mobile/src/components/SettingRows.tsx` (`SettingsGroup`, `NavRow`, `SwitchRow`, `SegmentRow`, `ValueRow`). In `SwitchRow` the whole row handles the tap and the `Switch` is display only: with two handlers, a tap on the switch did nothing. `SwitchRow` colors the track with `theme.colors.secondary` (the app's teal accent, already used for PRs and success states), not `theme.colors.primary` — that blue is close enough to Apple's system blue that a switch using it reads as an unstyled default control. `SegmentRow`'s segments have a fixed `minWidth` so short labels ("kg", "Sun") don't sit as a smaller pill than longer ones ("Light") and every segmented control on a page ends up the same width. Add a new preference to the page it belongs to, not to `SettingsScreen.tsx`. Web mirrors this: `/settings` is the hub and the pages are `/settings/{general,set-logger,categories,backup,gyms,ai}`, built from `frontend/components/settings/SettingRows.tsx`.
- Shared UI logic lives in core so both clients behave the same. Mobile is the reference: when the two differ, web changes to match. `@lift/core/dates` (`todayString`, `ymd`, `addDays`, `enumerateDates`, `buildMonthGrid`), `@lift/core/format` (exercise subtitle, timestamps, `labelForDate`, `noteActionLabel`, `niceDate`, `recordDate`, `agoLabel`, `formatDuration`, `formatRest`, `formatElapsed`), `@lift/core/settings` (`readSettings`: every `show_*` default in one place; `show_one_rm` is off unless set), `@lift/core/workouts` (`isEmptyWorkoutShell`, set-form prefill, gym name matching and rename checks), `@lift/core/setLogger`, `@lift/core/exerciseStats` (History / Graph / Summary), `@lift/core/categoryStyles`, `@lift/core/restTimer`, `@lift/core/monthPaging`, `@lift/core/oneRepMax`. `mobile/src/dates.ts`, `format.ts`, `restTimer/plan.ts` and `calendar/monthPaging.ts` are one-line re-exports of these. Import from them instead of writing another local copy. When you lift more logic out of a mobile screen, copy it verbatim, pin its behavior in a test, and keep the platform parts (animation, theme colors, native modules, storage) in the client.
