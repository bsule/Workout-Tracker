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
same surface the clients use.

## Layout

| File | Covers |
|------|--------|
| `units.test.ts` | kg/lb conversion, display formatting |
| `seed.test.ts` | bundled exercise seed (id space, `isSeedId`) |
| `blob.test.ts` | gzip serialize/parse + schema migrations v1→v4 |
| `indexes.test.ts` | snapshot → query indexes |
| `materialize.test.ts` | view-model mapping, Brzycki 1RM, durations |
| `queries.test.ts` | fuzzy match, exercise/workout/calendar queries |
| `mutations.test.ts` | every store mutation + cascade behavior |
| `prs.test.ts` | PR / historical-PR / position-PR computation |
| `fitnotesCsv.test.ts` | FitNotes CSV import (incl. the real fixture in `test_dbs/`) |
| `export.test.ts` | CSV/JSON exporters |
| `snapshotJson.test.ts` | JSON export ↔ import round-trip |
| `persist.test.ts` | crash-log replay, `runBatched`, flush |
| `sync.test.ts` | `CloudflareTransport` wire protocol (mocked `fetch`) |

## Helpers (`helpers/`)

- `store.ts` — `resetStore()` to reset the singleton between tests, plus an
  in-memory `BlobStorage` (`installMemoryStorage()`) for paths that flush.
- `build.ts` — terse builders for snapshot rows (exercise/workout/set) when a
  test needs to assert on derived state directly.

## What is *not* covered

The React / React Native UI and the Cloudflare Worker have no automated tests —
verify those by running the app or curling the worker. Fixtures (real FitNotes
exports) live in `../test_dbs/`, not here.
