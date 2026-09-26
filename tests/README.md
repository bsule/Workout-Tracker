# Tests

[Vitest](https://vitest.dev) suite for `@lift/core` — the TypeScript "brain"
shared by the web and mobile clients. Run from the repo root:

```bash
npm test            # one-shot (vitest run)
npm run test:watch  # watch mode
```

Vitest transpiles the core's raw `.ts` on the fly, so there's nothing to build
first. Tests import the core through its published `exports` subpaths
(`@lift/core/units`, `@lift/core/store/...`, `@lift/core/import`, etc.) — the
same surface the clients use. A few suites also cover pure logic modules that
live under `mobile/src`; they import those by relative path.

## Layout

| File | Covers |
|------|--------|
| `units.test.ts` | kg/lb conversion, display formatting |
| `seed.test.ts` | bundled exercise seed (id space, `isSeedId`) |
| `blob.test.ts` | gzip serialize/parse + schema migrations v1→v9 (incl. day notes) |
| `indexes.test.ts` | snapshot → query indexes |
| `materialize.test.ts` | view-model mapping, Brzycki 1RM, durations |
| `queries.test.ts` | fuzzy match, exercise/workout/calendar/day-note queries |
| `records.test.ts` | top-weight-per-rep records, overall and per position |
| `mutations.test.ts` | every store mutation + cascade behavior (incl. `setDayNote`, and the `created_at` the set logger passes) |
| `prs.test.ts` | PR / historical-PR / position-PR computation, and live flags matching a from-scratch pass after edits, deletes and sets logged on a past day |
| `predictPrFlags.test.ts` | the set logger's tap-time PR preview (`predictPrFlags` in `prs.ts`) matches the flags the store saves, over a random run of sets and over bursts of sets tapped before any is written (a fast double tap on Save), and a tie with an earlier set is never a record |
| `prsParity.test.ts` | randomized parity check: the incremental PR scan vs. pairwise rules |
| `deleteSets.test.ts` | batched multi-set delete: one notification, records promoted |
| `fitnotesCsv.test.ts` | FitNotes CSV import (incl. synthetic sample in `fixtures/`, built-in exercise names, kind mismatch with a built-in, deleted exercises, spacing and Unicode forms) |
| `export.test.ts` | CSV/JSON exporters (JSON includes `day_notes`) |
| `duplicateGyms.test.ts` | a Replace import does not add saved gyms a second time, and `dedupeGyms` (run on every load and cloud pull) drops exact-name duplicate gym rows an older import left, saving the fix |
| `sameDateAndGymCase.test.ts` | the JSON import keeps one workout per date (a file workout joins that day's workout whatever its gym; a second session's sets go after the first's; re-importing stays a no-op), and gym names that differ only in case are one gym: `createGym` returns the saved one, `patchWorkout` and imports store the saved spelling, `renameGym` refuses another gym's name in any case and carries every spelling of its own, and a `rename_gym` op replays after a crash |
| `snapshotJson.test.ts` | JSON export ↔ import round-trip (incl. note-only days, built-in exercises map to their seed ids unless the kind differs, deleted built-ins, collapsed spacing) |
| `persist.test.ts` | crash-log replay (incl. `set_day_note`), `runBatched`, flush, the counts each write passes to storage, a flush during a replace, account switches during hydrate/restore, edits during a slow save, sign-out joining an active save, fallback past damaged copies, and refusal to overwrite unreadable or newer-schema data |
| `previewRemote.test.ts` | looking at the cloud copy (`previewRemote`, used by the conflict dialog and restore screens) keeps the device's etag, so the next Sync now is still refused instead of overwriting a newer cloud copy; taking the copy (`applyRemoteBytes`) adopts its etag |
| `sync.test.ts` | `CloudflareTransport` wire protocol (mocked `fetch`) |
| `syncClock.test.ts` | the "last synced" clock and the daily `maybeAutoSync()` check |
| `sharedHelpers.test.ts` | the helpers both clients share, lifted from the mobile screens: settings defaults (`readSettings`; 1RM off unless set), dates and the month grid, day/record/ago labels, durations and rest labels, the empty-workout rule, set-form prefill, gym name matching and rename checks |
| `setLogger.test.ts` | set-logger rules both clients use (`@lift/core/setLogger`): form seed order, cardio and weight validation, rest editing, position counting, pairing saved rows with their tap-time placeholders (`matchPendingAdds`), Last time card helpers |
| `exerciseStats.test.ts` | History / Graph / Summary derivations (`@lift/core/exerciseStats`): past days only, last-session pick, chart values and axis steps, rep-record rows |
| `categoryStyles.test.ts` | the category styles model (`@lift/core/categoryStyles`): slugs, entry parsing, label/color edits, add/reset/remove |

Additional suites cover logic modules that live in `mobile/src` instead of the
core. They import those files by relative path. They render no components.

| File | Covers |
|------|--------|
| `monthPaging.test.ts` | calendar month geometry and paging offsets (the module now lives in `@lift/core/monthPaging`; mobile re-exports it) |
| `sameHistory.test.ts` | history-equality check that skips mobile re-renders (`@lift/core/exerciseStats`; mobile re-exports it) |
| `webStorageMove.test.ts` | the web account-store move: `users/<username>` to `accounts/<id>` in IndexedDB (on `fake-indexeddb`, one transaction) and OPFS (an in-memory directory tree; copy then delete, and a copy cut short runs again) |
| `swipeHold.test.ts` | `SwipeHold`, which defers a commit until a swipe ends |
| `restTimerPlan.test.ts` | rest timer rules (`@lift/core/restTimer`, re-exported by `mobile/src/restTimer/plan.ts`): cutoff parse/format/clamp, start vs. update vs. end, settings defaults and blob round-trip, that the two `RestTimerAttributes.swift` copies match, source guards on the iOS cutoff (armed for an adopted timer, ends only its own activity), and what the "since last set" ticker counts from (`lastSetAnchorMs`, and `tickerAnchor` after a manual reset or stop, which only applies on the workout day it was made on) |
| `restTimerController.test.ts` | rest timer controller call order against a mocked native bridge and `react-native` (Android permission), and Reset timer / Stop timer (native calls, the in-memory mark, `clearMark`) |
| `accountStore.test.ts` | the local store keyed by user id: a `users/<username>` store moves to `accounts/<id>` once on first load, a rename keeps the same store, an existing account store is never overwritten, and a failed move refuses to load |
| `signOut.test.ts` | mobile sign-out: the rest timer ends and its reset/stop mark is cleared, and the store is saved and dropped from memory |
| `snapshotRotation.test.ts` | mobile restore point rotation: `.bak` every write, `.bak2` only after 24 hours, the hold during a restore, the undo entry kept through a rotation, and stale labels dropped by mtime |
| `restorePoints.test.ts` | `RnFsStorage` against an in-memory `expo-file-system`: the real file moves over a day of saves, labels, the `.bak`/`.bak2` read fallback (including a `snapshot.bin` that reads but does not decode), and `restoreFromSlot()` (daily slot held, undo taken from memory, damaged file changes nothing, account switch cancels the restore) |

## Helpers (`helpers/`)

- `store.ts` — `resetStore()` to reset the singleton between tests, plus an
  in-memory `BlobStorage` (`installMemoryStorage()`) for paths that flush.
- `build.ts` — terse builders for snapshot rows (exercise/workout/set) when a
  test needs to assert on derived state directly.

## What is *not* covered

The React / React Native UI components, the native Swift/Kotlin modules and
widget extension, and the Cloudflare Worker have no
automated tests — verify those by running the app or curling the worker. Optional local FitNotes
sample DBs live in `../test_dbs/` (gitignored). The CSV fixture the suite uses
is tracked at `fixtures/fitnotes-sample.csv` (synthetic, not a personal export).
