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
- `cargo check --workspace --target wasm32-unknown-unknown`: portability gate.

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
