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

Current Rust scope includes models, commands, PRs, queries, chart/summary data,
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

The initial Rust engine still clones snapshots and rebuilds indexes when
preparing/publishing. It is a correctness foundation, not the final optimized
storage model. History currently uses bounded offset pages; revision-bound
cursors, generated TypeScript DTOs and selective invalidation remain pending.
Native errors are currently string-based; structured codes remain pending.

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
