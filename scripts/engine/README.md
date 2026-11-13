# Engine migration tools

Mobile uses the Rust engine through its Expo module; web still uses the shared
TypeScript store. This directory holds parity fixtures, native/Wasm builds and
performance diagnostics for [the migration plan](../../docs/rust-migration.md).

- `npm test`: existing behavior baseline.
- `npm run engine:baseline`: synthetic desktop timings; writes raw samples to
  ignored `benchmarks/local/typescript-baseline.json`. One warm-up and five timed
  samples per operation; do not interpret five samples as reliable tail latency.
  `cloneAndHydrateIndexes` includes cloning; other operations exclude setup.
- `npm run engine:oracle`: regenerate deterministic unit-conversion fixtures from
  the current TypeScript implementation. Review fixture changes before accepting.
- `cargo test --workspace`: Rust compatibility tests, including those fixtures.
- `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
- `cargo check -p lift-domain --target wasm32-unknown-unknown`: portability gate.

Install Rust with rustup, then ensure `~/.cargo/bin` is on PATH. The workspace
pins its toolchain in `rust-toolchain.toml`. Unit and desktop benchmarks do not
measure Expo bridge costs or phone performance. Use the simulator smoke checks
and release-device measurements for those boundaries.

Baseline measured on the development machine: all 44 suites / 577 tests passed;
mobile, web and Cloudflare typechecks passed. At 100k synthetic sets, approximate
median desktop timings were 378 ms serialize, 82 ms parse, 30 ms addSet and
17 ms affected-exercise PR calculation. That dataset distributes sets over ten exercises. `stress_bench` also measures
concentrated histories; real release-device measurements remain separate.

### Benchmark results (TypeScript baseline vs. Rust engine)

Desktop diagnostics from one Apple Silicon Mac, release build, means of five timed samples. They are not phone numbers. Reproduce with `npm run engine:baseline`, `cargo bench -p lift-engine --bench engine_bench` and `cargo bench -p lift-native --bench native_bench`.

| Operation | Sets | TypeScript (mean) | Rust (mean) | Result |
| :--- | :--- | :--- | :--- | :--- |
| `cloneAndHydrateIndexes` (load into a ready engine) | 1,000 | 1.14 ms | 0.22 ms | 5.1x faster |
|  | 10,000 | 10.51 ms | 1.34 ms | 7.9x faster |
|  | 50,000 | 59.43 ms | 7.62 ms | 7.8x faster |
|  | 100,000 | 107.81 ms | 16.66 ms | 6.5x faster |
| `prExercise` (full PR pass, one exercise) | 1,000 | 0.20 ms | 0.17 ms | 1.2x faster |
|  | 10,000 | 1.57 ms | 0.62 ms | 2.5x faster |
|  | 50,000 | 6.79 ms | 3.16 ms | 2.1x faster |
|  | 100,000 | 15.06 ms | 6.55 ms | 2.3x faster |
| `history` (one exercise, all 100-day pages) | 1,000 | 0.03 ms | 0.24 ms | 7.3x slower |
|  | 10,000 | 0.12 ms | 2.24 ms | 18.5x slower |
|  | 50,000 | 0.51 ms | 11.96 ms | 23.3x slower |
|  | 100,000 | 1.25 ms | 25.69 ms | 20.6x slower |
| `addSet` (in memory: command, PRs, diff, publish) | 1,000 | 0.25 ms | 0.21 ms | 1.2x faster |
|  | 10,000 | 1.59 ms | 0.34 ms | 4.6x faster |
|  | 50,000 | 9.89 ms | 1.69 ms | 5.8x faster |
|  | 100,000 | 22.58 ms | 3.54 ms | 6.4x faster |
| `serialize` (JSON + gzip) | 1,000 | 4.57 ms | 1.53 ms | 3.0x faster |
|  | 10,000 | 37.76 ms | 11.31 ms | 3.3x faster |
|  | 50,000 | 191.87 ms | 56.21 ms | 3.4x faster |
|  | 100,000 | 378.22 ms | 129.76 ms | 2.9x faster |
| `parse` (gunzip + JSON + version check) | 1,000 | 1.19 ms | 0.73 ms | 1.6x faster |
|  | 10,000 | 8.59 ms | 5.81 ms | 1.5x faster |
|  | 50,000 | 38.69 ms | 29.73 ms | 1.3x faster |
|  | 100,000 | 81.44 ms | 59.67 ms | 1.4x faster |

History was remeasured on 2026-11-12. The benchmark now reads every page and asserts
that the returned count equals the total. Earlier results silently measured only
the first 100 days on Rust, while TypeScript read the whole history. Rust still
builds JSON values ready for the bridge; TypeScript returns cached objects. These
numbers exclude native bridge overhead. Other rows retain the earlier baseline.

Native durable path (medians):

| Sets | First open with legacy migration | Cold open from SQLite | `addSet` including SQLite commit |
| :--- | :--- | :--- | :--- |
| 1,000 | 26 ms | 2.7 ms | 0.25 ms |
| 10,000 | 72 ms | 8.8 ms | 0.44 ms |
| 50,000 | 329 ms | 38.9 ms | 1.63 ms |
| 100,000 | 825 ms | 95.1 ms | 4.06 ms |

The old mobile save path also paid a debounced full-snapshot flush (the `serialize` row) every 30 seconds of activity. The engine commits only the changed rows, so that flush no longer exists.

Rust scope includes models, commands, PRs, queries, chart/summary data,
legacy gzip migrations/replay, JSON export, FitNotes CSV import, SQLite storage
and Wasm prepare/persist/publish. Negative-half rounding matches JavaScript.

## Native binding proof

`node scripts/engine/bindings.mjs` builds the pinned UniFFI library and generates
Swift/Kotlin under ignored `target/bindings/`. On macOS,
`node scripts/engine/swift-smoke.mjs` compiles and runs real Swift-to-Rust calls.

`lift-native` is intentionally excluded from Wasm portability checks; only the
portable domain must compile there. Native library and binding-generator versions
are locked together. The lockfile pins textwrap 0.16.2 because newer 0.16.4
requires Rust 1.88, above the workspace's pinned 1.85.1 toolchain.

The Expo module is in `mobile/modules/lift-engine/`. Run
`node scripts/engine/prepare-native.mjs ios` (or `android`) before native builds.
This generates ignored bindings and target libraries; CocoaPods autolinking is
verified. Production mobile screens use account-scoped engine sessions; web
continues to use its TypeScript store.
Android arm64/x86_64 Rust libraries compile with NDK 27.1.12297006.
Full app runtime and background execution checks remain pending.

Verified native Rust cross-compilation targets: `aarch64-apple-ios` and
`aarch64-apple-ios-sim`. Install with `rustup target add` then run
`cargo build -p lift-native --locked --target <target>`. Target compilation alone
does not establish an installable Expo app or runtime background-thread behavior.

## Expanded compatibility checks

`npm run engine:fixtures` regenerates the command/query, legacy-schema, PR and
CSV-import oracles. `npm run engine:wasm` needs wasm-bindgen-cli 0.2.100 and builds
both web and Node bindings. `node scripts/engine/wasm-smoke.mjs` executes the
fixture trace through actual Wasm. `npm run engine:integration` then connects
actual Wasm to the worker coordinator and fake-indexeddb transactional adapter.
The last check is not a real-browser test.

Snapshot tables use chunked copy-on-write sharing; unchanged chunks skip
validation, row diffing and index rebuilding. Ordinary set edits copy the
affected chunks and update indexes row by row.
History supports bounded pages and revision-bound cursors. Model/input types
are generated with `cargo run -p lift-domain --features typescript --bin
lift-typescript -- packages/engine-client/src/generated`. Output queries are typed on the client, native errors have stable bridge codes,
and query invalidation and durable writes are selective. History pagination is
bound to a committed revision.

## Expo simulator verification

The full iOS arm64 simulator app builds with the module linked. Start Metro
with `EXPO_PUBLIC_ENGINE_SMOKE=1`, install the development build and launch it.
The development-only check in `mobile/src/engine/smoke.ts` uses a temporary cache
database, verifies retry/reopen behavior, removes its data and logs
`[lift-engine-smoke] PASS`. It never accesses an account store. This check passed
on the iPhone 17 Pro simulator. Mobile screens now use Rust; web remains on TypeScript.

Android module `:lift-engine:compileDebugKotlin` passes. Device runtime still needs verification.

## Import, restore and sync checkpoint

User JSON import is tested against replace and repeated-merge TypeScript traces.
Malformed JSON is rejected atomically even in replace mode, intentionally fixing
the old path that could clear data for invalid input. Imports use a SHA-256
content identity for receipts rather than retaining entire files in retry rows.

Native local schema is now v4 (binary rows); restore points live in a separate
backup database. Snapshot replacement atomically writes undo,
records, revision, generation and sync metadata. Local restore retains ETags and
marks data dirty; remote replacement adopts its ETag only after commit. Native
restore-point capture preserves previous/daily slots. Late upload acknowledgement
keeps newer edits dirty. These APIs are exposed through UniFFI and used by the mobile backup/sync screens. Failure-injection tests exercise receipt and undo
write rollback, and the Swift smoke checks binary snapshot/restore calls.

The expanded iOS Expo smoke also passes JSON import, Uint8Array snapshot transfer,
restore-point creation/listing and sync dirty-state checks in a cache database.


## Mobile export integration

`ImportExportScreen` uses `EngineDataApi` for native JSON and FitNotes exports.
The engine captures a snapshot under its lock and encodes outside it on the
capture queue, so later set saves need not wait behind compression. The
transitional legacy exporters remain for compatibility tooling and smoke tests.

The installed iOS smoke checks native exports, AI response parsing, binary
upload payloads, push acknowledgement and generation replacement. It uses a
cache-only synthetic database and never opens an account store.

## Additional benchmarks

See [the 2026-11-12 results](../../docs/benchmarks.md) for everyday-operation, PR,
concentrated-history, concurrent-capture and worker-encoding measurements.

- `cargo bench -p lift-native --bench operations_bench`: everyday operations at
  1k, 10k, 100k and 250k sets across ten exercises. Measures adding, editing and
  removing one set; recomputing all PRs; predicting PRs with and without queued
  efforts; loading a workout day, calendar month, exercise list, search,
  single exercise, 30 history days, settings, counts, chart and records; and
  reopening the local database. One warm-up and seven samples per operation.
  Adds/edits/deletes form a cycle so size stays fixed. Setup and request JSON
  encoding are excluded; native command timings include SQLite commit and
  receipt encoding, query timings include DTO/JSON encoding. Reopen timings
  use a warm OS file cache, not a physical-device cold boot. Samples are in
  `benchmarks/local/rust-operations-results.json`.
- `cargo bench -p lift-native --bench stress_bench`: 10k, 100k and 250k sets,
  spread across ten exercises or concentrated in one. Separates the first
  append (verification of loaded PR flags) from verified incremental appends,
  backdated edits, the first history page, all history pages, and saves during
  a concurrent upload capture. Captures and queries run on real Rust/SQLite,
  without Expo overhead; all databases are disposable. The concurrent capture
  uses a barrier and a 2 ms head start, so its overlap is diagnostic rather
  than a strict scheduler guarantee.
- `npm run engine:encoding-bench`: runs the exact browser snapshot-worker source
  on a Node worker thread against synchronous JSON/gzip at the same sizes. Five
  recorded samples per size after warm-up, byte-for-byte decompressed validation,
  wall time and a 2 ms event-loop ticker. Node's structured-clone and scheduling
  costs differ from browser costs; the lag is not a measured phone frame rate.

Raw samples are saved in ignored `benchmarks/local/rust-stress-results.json`
and `benchmarks/local/web-encoding-results.json`. Run benchmarks without a
concurrent Xcode build or other heavy workload. Results are desktop diagnostics,
not service latency guarantees or statistically robust tail percentiles.
