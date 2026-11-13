# Engine migration tools

The production app still uses TypeScript. This directory supports implementation of
[the migration plan](../../docs/rust-migration.md).

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
pins its toolchain in `rust-toolchain.toml`. No native module or mobile binary
has been wired yet; these checks do not test a phone or bridge.

Baseline measured on the development machine: all 44 suites / 577 tests passed;
mobile, web and Cloudflare typechecks passed. At 100k synthetic sets, approximate
median desktop timings were 378 ms serialize, 82 ms parse, 30 ms addSet and
17 ms affected-exercise PR calculation. Dataset distributes sets over ten
exercises; concentrated histories and real release-device measurements remain.

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
| `history` (one exercise, whole history) | 1,000 | 0.03 ms | 0.36 ms | 12.1x slower |
|  | 10,000 | 0.13 ms | 2.18 ms | 17.3x slower |
|  | 50,000 | 2.85 ms | 2.27 ms | 1.3x faster |
|  | 100,000 | 1.15 ms | 2.57 ms | 2.2x slower |
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

`history` returns a JSON value ready for the bridge, while the TypeScript query returns cached objects, so that row is not like for like.

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
verified. Production screens still use the old store pending full cutover.
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

Snapshot tables use copy-on-write sharing; unchanged tables skip validation,
row diffing and index rebuilding. Set edits still clone/rebuild their table.
History supports bounded pages and revision-bound cursors. Model/input types
are generated with `cargo run -p lift-domain --features typescript --bin
lift-typescript -- packages/engine-client/src/generated`. Typed output DTOs,
structured errors, selective invalidation and row-level updates remain pending.

## Expo simulator verification

The full iOS arm64 simulator app builds with the module linked. Start Metro
with `EXPO_PUBLIC_ENGINE_SMOKE=1`, install the development build and launch it.
The development-only check in `mobile/src/engine/smoke.ts` uses a temporary cache
database, verifies retry/reopen behavior, removes its data and logs
`[lift-engine-smoke] PASS`. It never accesses an account store. This check passed
on the iPhone 17 Pro simulator. Production screens still use TypeScript.

Android module `:lift-engine:compileDebugKotlin` passes. Device runtime still needs verification.

## Import, restore and sync checkpoint

User JSON import is tested against replace and repeated-merge TypeScript traces.
Malformed JSON is rejected atomically even in replace mode, intentionally fixing
the old path that could clear data for invalid input. Imports use a SHA-256
content identity for receipts rather than retaining entire files in retry rows.

Native local schema is now v2. Snapshot replacement atomically writes undo,
records, revision, generation and sync metadata. Local restore retains ETags and
marks data dirty; remote replacement adopts its ETag only after commit. Native
restore-point capture preserves previous/daily slots. Late upload acknowledgement
keeps newer edits dirty. These APIs are exposed through UniFFI; Expo backup/sync
screens are not switched yet. Failure-injection tests exercise receipt and undo
write rollback, and the Swift smoke checks binary snapshot/restore calls.

The expanded iOS Expo smoke also passes JSON import, Uint8Array snapshot transfer,
restore-point creation/listing and sync dirty-state checks in a cache database.


## Current mobile export integration

JSON and FitNotes exports in `ImportExportScreen` now call native Rust when the
module is present. The transitional read-only export functions accept the
legacy snapshot and run SQLite/ZIP/JSON conversion on the native queue; they do
not open another account database or introduce a second writer. Expo Go keeps
the previous exporter. Full session cutover will remove this bulk legacy
snapshot boundary and call `EngineDataApi` directly.

The expanded installed iOS smoke passes native exports, AI response parsing,
Uint8Array upload payloads, push acknowledgement and generation replacement.
Rust PR prediction also compares against TypeScript for queued saves. The
async client serializes imports/restores with ordinary commands and advances
its generation after replacement.
