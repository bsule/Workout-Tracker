# Desktop benchmarks — 2026-11-12

Measured on the development Apple Silicon Mac with synthetic data, release Rust
builds and local SQLite. These are desktop diagnostics, not phone latency or
Expo bridge measurements. The updated iPhone 17 Pro simulator Release build was
installed and launched separately; the tables below were not measured there.

## Matched TypeScript vs. Rust at 100,000 sets

These compare the retained legacy TypeScript implementation with the current
Rust engine on this Mac. Both start from the **exact same verified snapshot**
exported by the Rust fixture generator: ten exercises, ten sets per workout,
one workout per day. One warm-up and seven samples, reported as medians.
Recent set additions are chronological appends; edits and deletes act on the
newly added row. This differs from the older baseline's backdated append.

| Operation | TypeScript, in memory | Rust, in memory | Rust native, including commit/encoding |
| :--- | ---: | ---: | ---: |
| Add set | 22.955 ms | 0.594 ms | 1.094 ms |
| Edit set | 19.455 ms | 3.145 ms | 3.430 ms |
| Delete set | 19.572 ms | 23.409 ms | 24.492 ms |
| Predict PR | 0.968 ms | 0.443 ms | 0.308 ms |
| Predict PR with two queued efforts | 0.647 ms | 0.165 ms | 0.170 ms |
| Recompute all PRs | 157.882 ms | 34.072 ms | 34.762 ms |
| Load workout day | 0.012 ms | 0.046 ms | 0.048 ms |
| Load calendar month | 0.025 ms | 0.313 ms | 0.280 ms |

The two in-memory columns exclude filesystem work. TypeScript mutations include
its index rebuild; Rust mutations include prepare/publish and incremental index
maintenance. The native column adds SQLite commit and receipt JSON encoding for
mutations. Its query rows include DTO/JSON encoding, not a database write. Rust's
in-memory queries also construct JSON values, while TypeScript returns objects
from its store, so very small query timings are not a pure language comparison.

TypeScript's old persistence model appends crash-log operations and periodically
saves a whole gzip snapshot. Its in-memory mutation time does **not** include that
save. Rust saves changed rows immediately. Do not describe the difference between
the first and last columns as an equivalent per-save durability speedup.

Rust was faster for appends, edits and PR computation in this run, but deletion
and small queries were slower. The table reports those regressions too.

| Open persisted data, warm OS file cache | TypeScript snapshot | Rust SQLite |
| :--- | ---: | ---: |
| Ready for queries | 99.278 ms | 42.940 ms |

TypeScript startup reads the local gzip file, decompresses/parses it and builds
indexes. Rust opens the local database, loads binary rows and builds indexes.
Both are ready for queries; neither includes React rendering or Expo bridge costs.

Reproduce the matched in-memory workloads and TypeScript startup with
`npm run engine:operations`. This emits the Rust fixture JSON and both raw result
files under ignored `benchmarks/local/`. Native durable measurements are produced
separately with `cargo bench -p lift-native --bench operations_bench`.

## Everyday native operations

One warm-up and seven recorded samples per operation, reported as medians in
milliseconds. Each workout has ten sets, distributed across ten exercises.
Adding, editing and deleting form a cycle so the dataset size stays fixed.
Command timings include PR work, SQLite commit and receipt JSON encoding; query
timings include native DTO/JSON encoding. Request JSON preparation and fixture
migration are outside the timed regions. Reopening uses a warm OS file cache.

| Operation | 1,000 sets | 10,000 sets | 100,000 sets | 250,000 sets |
| :--- | ---: | ---: | ---: | ---: |
| Add set (durable) | 0.253 | 0.308 | 1.094 | 2.397 |
| Edit set (durable) | 0.209 | 0.430 | 3.430 | 10.614 |
| Delete set (durable) | 0.428 | 1.934 | 24.492 | 67.842 |
| Recompute all PRs (durable) | 0.476 | 2.783 | 34.762 | 102.255 |
| Predict PR | 0.004 | 0.019 | 0.308 | 1.159 |
| Predict PR with two queued efforts | 0.004 | 0.017 | 0.170 | 0.525 |
| Load workout day | 0.051 | 0.043 | 0.048 | 0.052 |
| Load calendar month | 0.012 | 0.043 | 0.280 | 0.667 |
| Load exercise list | 0.170 | 0.234 | 2.179 | 7.508 |
| Search exercise list | 0.039 | 0.050 | 0.318 | 1.307 |
| Load one exercise | 0.002 | 0.002 | 0.003 | 0.004 |
| Load 30 history days | 0.301 | 0.719 | 0.947 | 1.384 |
| Load settings | 0.003 | 0.003 | 0.003 | 0.004 |
| Load counts | 0.002 | 0.010 | 0.311 | 0.834 |
| Load 1RM chart | 0.127 | 1.025 | 12.203 | 31.376 |
| Load records | 0.126 | 0.900 | 10.831 | 28.109 |
| Reopen local database | 1.756 | 5.384 | 42.940 | 116.820 |

`recomputeAllPrs` computes all current, historical and position flags, even when
rows are already correct. Predictions include overall and position-PR results.
The older in-memory engine benchmark additionally isolates one-exercise PR
recomputation (`prExercise`), separately from native commit overhead.

## One-exercise PR calculation alone

Means of five recorded desktop samples after warm-up, excluding engine setup,
SQLite and bridge work. This recomputes current, historical and position flags
for one exercise in a snapshot spread across ten exercises.

| Total sets | TypeScript | Rust |
| :--- | ---: | ---: |
| 1,000 | 0.208 ms | 0.123 ms |
| 10,000 | 1.568 ms | 0.640 ms |
| 50,000 | 7.887 ms | 3.333 ms |
| 100,000 | 16.467 ms | 7.161 ms |

## Concentrated histories and concurrent captures

Append columns are medians of seven consecutive writes. First append, backdated
edit, complete history and upload capture are single diagnostic runs. A first
append verifies untrusted flags loaded from the fixture; later appends can use
the incremental PR path. This deliberately measures a cold verification case.

| Sets | Exercises used | First append | Verified append | Backdated edit | All history | Append during capture | Upload capture |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 10 | 0.97 ms | 0.19 ms | 0.63 ms | 3.34 ms | 0.20 ms | 8.95 ms |
| 10,000 | 1 | 4.17 ms | 0.51 ms | 3.23 ms | 36.05 ms | 0.52 ms | 8.71 ms |
| 100,000 | 10 | 4.27 ms | 0.64 ms | 3.90 ms | 36.39 ms | 0.64 ms | 85.63 ms |
| 100,000 | 1 | 42.89 ms | 4.18 ms | 45.80 ms | 601.26 ms | 4.40 ms | 85.53 ms |
| 250,000 | 10 | 10.82 ms | 1.51 ms | 10.12 ms | 103.06 ms | 1.57 ms | 213.09 ms |
| 250,000 | 1 | 131.99 ms | 11.02 ms | 132.14 ms | 2644.74 ms | 12.31 ms | 225.86 ms |

Complete history reads every 100-day page, including JSON parsing on the desktop
host. Each page currently scans the exercise's history again. Concentrating
250,000 sets into one exercise means 25,000 workout days, an intentionally severe
case; all-history loading remains expensive. Deleting sets also remains slower
than appending because removal rebuilds positions and the affected PR history.

Capture and writes start from separate threads with a barrier and a 2 ms capture
head start; exact overlap depends on scheduling. Even the largest compressed
snapshot was about 2.18 MB, below the new 8 MiB upload limit. Do not interpret
these few samples as reliable tail latency or a scheduling guarantee.

## Snapshot encoding: main thread versus worker

The exact browser worker source runs in a Node worker thread. Five recorded
samples after warm-up; medians in milliseconds. A 2 ms ticker measures the
largest event-loop delay in each sample. Structured cloning still runs partly
on the sending thread; browsers and Node can have different costs.

| Sets | Main-thread encoding wall time | Worker encoding wall time | Main-thread encoding stall | Worker encoding stall |
| :--- | ---: | ---: | ---: | ---: |
| 10,000 | 38.85 | 50.89 | 38.09 | 2.95 |
| 100,000 | 375.45 | 497.75 | 374.64 | 38.45 |
| 250,000 | 951.88 | 1305.92 | 952.00 | 100.88 |

The worker improves responsiveness, not total throughput: encoding takes longer
end to end because of copying and thread communication. Decompressed bytes are
validated against the synchronous encoder after every sample. Gzip timestamps
may differ. This is not a browser animation or physical-device frame-rate test.

## Reproduce

Run from the repository root without other heavy compilation workloads:

```bash
cargo bench -p lift-native --bench operations_bench
cargo bench -p lift-native --bench stress_bench
npm run engine:encoding-bench
# Existing TypeScript vs. portable Rust comparisons, including PRs:
npm run engine:baseline
cargo bench -p lift-engine --bench engine_bench
```

Raw samples live in gitignored `benchmarks/local/`: `rust-operations-results.json`,
`rust-stress-results.json`, `web-encoding-results.json`, `typescript-baseline.json`
and `rust-results.json`. Dataset builders and measurement code are committed so
these results can be reproduced. See [engine tools](../scripts/engine/README.md)
for native build, parity and simulator-smoke details.
