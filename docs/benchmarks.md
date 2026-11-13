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
| Add set | 22.955 ms | 0.513 ms | 1.060 ms |
| Edit set | 19.455 ms | 3.014 ms | 3.415 ms |
| Delete set | 19.572 ms | 3.092 ms | 3.289 ms |
| Predict PR | 0.968 ms | 0.435 ms | 0.294 ms |
| Predict PR with two queued efforts | 0.647 ms | 0.166 ms | 0.178 ms |
| Recompute all PRs | 157.882 ms | 33.685 ms | 34.792 ms |
| Load workout day | 0.012 ms | 0.038 ms | 0.053 ms |
| Load calendar month | 0.025 ms | 0.298 ms | 0.287 ms |

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

After optimizing deletion, Rust was faster for mutations and PR computation in
this run. Small queries were slower; the table reports those regressions too.

| Open persisted data, warm OS file cache | TypeScript snapshot | Rust SQLite |
| :--- | ---: | ---: |
| Ready for queries | 99.278 ms | 41.457 ms |

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
| Add set (durable) | 0.238 | 0.275 | 1.060 | 2.356 |
| Edit set (durable) | 0.216 | 0.399 | 3.415 | 9.705 |
| Delete set (durable) | 0.201 | 0.395 | 3.289 | 9.649 |
| Recompute all PRs (durable) | 0.472 | 2.764 | 34.792 | 98.256 |
| Predict PR | 0.004 | 0.018 | 0.294 | 1.188 |
| Predict PR with two queued efforts | 0.004 | 0.016 | 0.178 | 0.537 |
| Load workout day | 0.050 | 0.042 | 0.053 | 0.060 |
| Load calendar month | 0.011 | 0.043 | 0.287 | 0.666 |
| Load exercise list | 0.154 | 0.224 | 2.080 | 6.786 |
| Search exercise list | 0.037 | 0.049 | 0.322 | 1.018 |
| Load one exercise | 0.003 | 0.002 | 0.002 | 0.003 |
| Load 30 history days | 0.287 | 0.703 | 0.919 | 1.326 |
| Load settings | 0.003 | 0.003 | 0.004 | 0.004 |
| Load counts | 0.002 | 0.008 | 0.320 | 0.852 |
| Load 1RM chart | 0.125 | 0.977 | 11.393 | 30.046 |
| Load records | 0.136 | 0.889 | 10.183 | 27.126 |
| Reopen local database | 1.771 | 4.973 | 41.457 | 112.013 |

`recomputeAllPrs` computes all current, historical and position flags, even when
rows are already correct. Predictions include overall and position-PR results.
The older in-memory engine benchmark additionally isolates one-exercise PR
recomputation (`prExercise`), separately from native commit overhead.

## Deletion optimization: before and after

The same native add/edit/delete cycle, one warm-up and seven samples, measured
before committing the deletion changes. Includes SQLite commit and receipt
encoding. The row removed here is the most recently appended logged set.

| Total sets | Previous Rust | Optimized Rust | Speedup |
| :--- | ---: | ---: | ---: |
| 1,000 | 0.428 ms | 0.201 ms | 2.1× |
| 10,000 | 1.934 ms | 0.395 ms | 4.9× |
| 100,000 | 24.492 ms | 3.289 ms | 7.4× |
| 250,000 | 67.842 ms | 9.649 ms | 7.0× |

The optimized path removes known positions by chunk and translates the old
indexes for PR reads. It no longer builds a full temporary index just to
recompute the affected exercise. Suffix deletion updates the surviving indexes
in place at publish; middle deletion rebuilds the set indexes once. Deleting a
planned row skips PR work only when the existing flags are already verified;
unverified data still gets the full repair pass.

Additional deletion cases below measure in-memory prepare/publish only. Fresh
engine setup, initial PR verification and comparison against a full recomputation
are outside the timer; seven samples after one warm-up. Tail-record deletion
promotes prior records, and middle deletion changes the surviving positions.

| Sets | Logged tail | Logged middle | Record tail | Planned tail |
| :--- | ---: | ---: | ---: | ---: |
| 10,000 | 0.291 ms | 0.831 ms | 0.294 ms | 0.015 ms |
| 100,000 | 3.448 ms | 11.294 ms | 3.504 ms | 0.017 ms |
| 250,000 | 9.858 ms | 31.750 ms | 10.130 ms | 0.018 ms |

Reproduce with `cargo bench -p lift-engine --bench deletion_bench`. Raw samples
are in `benchmarks/local/rust-deletion-cases.json`; the pre-optimization native
samples are preserved locally as `rust-operations-before-deletion.json`.
The regression tests compare tail, middle, record, batch, unknown/duplicate ID,
planned and delete-all results to full PR recomputation and fresh indexes. SQLite
reopen tests check record promotion, survivor ordering and appending after deletes.

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

These capture/history measurements precede the deletion optimization; they do
not time deletion and are retained as the earlier stress run.

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
