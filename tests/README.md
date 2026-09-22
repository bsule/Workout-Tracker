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
| `blob.test.ts` | gzip serialize/parse + schema migrations v1→v8 (incl. day notes) |
| `indexes.test.ts` | snapshot → query indexes |
| `materialize.test.ts` | view-model mapping, Brzycki 1RM, durations |
| `queries.test.ts` | fuzzy match, exercise/workout/calendar/day-note queries |
| `records.test.ts` | top-weight-per-rep records, overall and per position |
| `mutations.test.ts` | every store mutation + cascade behavior (incl. `setDayNote`, and the `created_at` the set logger passes) |
| `prs.test.ts` | PR / historical-PR / position-PR computation |
| `prsParity.test.ts` | randomized parity check: the incremental PR scan vs. pairwise rules |
| `deleteSets.test.ts` | batched multi-set delete: one notification, records promoted |
| `fitnotesCsv.test.ts` | FitNotes CSV import (incl. synthetic sample in `fixtures/`, built-in exercise names, kind mismatch with a built-in, deleted exercises, spacing and Unicode forms) |
| `export.test.ts` | CSV/JSON exporters (JSON includes `day_notes`) |
| `snapshotJson.test.ts` | JSON export ↔ import round-trip (incl. note-only days, built-in exercises map to their seed ids unless the kind differs, deleted built-ins, collapsed spacing) |
| `persist.test.ts` | crash-log replay (incl. `set_day_note`), `runBatched`, flush, the counts each write passes to storage, a flush during a replace, a user switch unloading the old data, and the fallback past a copy that does not parse |
| `sync.test.ts` | `CloudflareTransport` wire protocol (mocked `fetch`) |
| `syncClock.test.ts` | the "last synced" clock and the daily `maybeAutoSync()` check |

Five suites cover logic modules that live in `mobile/src` instead of the
core. They import those files by relative path. They render no components.

| File | Covers |
|------|--------|
| `monthPaging.test.ts` | calendar month geometry and paging offsets |
| `sameHistory.test.ts` | history-equality check that skips mobile re-renders |
| `swipeHold.test.ts` | `SwipeHold`, which defers a commit until a swipe ends |
| `restTimerPlan.test.ts` | rest timer rules: cutoff parse/format/clamp, start vs. update vs. end, settings defaults and blob round-trip, that the two `RestTimerAttributes.swift` copies match, and source guards on the iOS cutoff (armed for an adopted timer, ends only its own activity) |
| `restTimerController.test.ts` | rest timer controller call order against a mocked native bridge and `react-native` (Android permission) |
| `signOut.test.ts` | mobile sign-out: the rest timer ends, and the store is saved and dropped from memory |
| `snapshotRotation.test.ts` | mobile restore point rotation: `.bak` every write, `.bak2` only after 24 hours, the hold during a restore, the undo entry kept through a rotation, and stale labels dropped by mtime |
| `restorePoints.test.ts` | `RnFsStorage` against an in-memory `expo-file-system`: the real file moves over a day of saves, labels, the `.bak`/`.bak2` read fallback (including a `snapshot.bin` that reads but does not decode), and `restoreFromSlot()` (daily slot held, undo taken from memory, damaged file changes nothing) |

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
