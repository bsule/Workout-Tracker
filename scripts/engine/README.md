# Engine migration tools

The production app still uses TypeScript. This directory starts stages 0/1 of
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

Current Rust scope: weight conversion, comparison quantization and display
rounding. Formatting strings stays outside this initial port. Negative-half
rounding explicitly matches JavaScript rather than Rust's default rounding.

## Native binding proof

`node scripts/engine/bindings.mjs` builds the pinned UniFFI library and generates
Swift/Kotlin under ignored `target/bindings/`. On macOS,
`node scripts/engine/swift-smoke.mjs` compiles and runs real Swift-to-Rust calls.

`lift-native` is intentionally excluded from Wasm portability checks; only the
portable domain must compile there. Native library and binding-generator versions
are locked together. The lockfile pins textwrap 0.16.2 because newer 0.16.4
requires Rust 1.88, above the workspace's pinned 1.85.1 toolchain.

The TypeScript facade and queued Swift wrapper in `expo-spike/` are staging code,
outside Expo autolinking until native packaging and both platforms are proven.
They do not replace any production store. The Android wrapper, NDK compilation,
Expo runtime and event/cancellation proof remain pending.

Verified native Rust cross-compilation targets: `aarch64-apple-ios` and
`aarch64-apple-ios-sim`. Install with `rustup target add` then run
`cargo build -p lift-native --locked --target <target>`. Target compilation alone
does not establish an installable Expo app or runtime background-thread behavior.
