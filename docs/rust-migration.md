# Rust workout engine migration plan

Status: implementation in progress on `feat/rust-workout-engine`. Not yet verified on a device.

- **Mobile:** the Rust engine is the only owner of workout data. The `@lift/core` store no longer hydrates, flushes or syncs on mobile. The open moves a `users/<username>` store to `accounts/<id>` once, before the engine opens, and a failed move refuses the load. Rust then migrates the legacy files (snapshot candidates, `pending.log`, restore points) and carries the old `lift.sync.etag`. Screens, sync (auto sync, Sync now, pull, force push, conflict prompt), restore points, the rest timer controller, AI apply, imports and exports run through `@lift/engine-client`. The set logger's first save is one `log_set` command. Screens keep their last data while covered and on reopen, and failed reads reach an error boundary instead of rendering as empty.
- **Web:** unchanged from `main`. The `@lift/core` store is the only owner, and nothing in the running app loads the engine. `frontend/lib/engine/webEngine.ts` is parked behind `NEXT_PUBLIC_LIFT_WEB_ENGINE=1` and refuses to open over legacy browser data until browser migration exists. The worker it would load is bundled from `packages/engine-client/src/browser-worker.ts` by `scripts/engine/web-worker-build.mjs`. Generated Wasm and worker files are gitignored, not committed.
- **Verification:** Vitest passes, and the TypeScript side is covered by fakes (transports, a Wasm factory, `fake-indexeddb`, mocked Expo modules). Mobile tsc depends on the bridge contract (`openNativeTransport` legacy argument, `engineErrorCode`) that the Rust side is landing. Nothing has run in a real browser or on a phone yet.

### Verified implementation

- Portable models, atomic set logging, commands, current/historical/position PRs, queued-save PR prediction, search, workouts, calendar, paged history, charts, statistics, AI history selection and AI plan parsing/application.
- TypeScript-generated compatibility fixtures cover units, command/query traces, PRs, legacy gzip schemas v1–v9, pending replay, JSON imports/exports, FitNotes CSV imports and database export. AI applies each accepted day atomically, intentionally improving the old partial-day failure behavior.
- Native SQLite commits records, allocator, revision, retry identity, dirty state and replacement undo atomically. Repeated command IDs cannot create duplicate sets. Original legacy files remain after staged migration. Future schemas and unreadable legacy stores do not become empty databases.
- Local restore retains cloud ETags and becomes dirty. Remote replacement adopts its ETag only after commit. Uploads capture a committed revision and installation device ID; late acknowledgements preserve newer edits. Previous/daily/undo restore-point APIs are implemented.
- Expo module autolinking, iOS device/simulator Rust builds, full iOS simulator app build/runtime and Android arm64/x86_64 Rust builds/Kotlin compilation are verified. The iOS development smoke checks commit, retry, import, native exports, AI parsing, binary upload/acknowledgement, generation replacement, restore-point capture and reopen in a synthetic cache database. Android runtime remains unverified.
- Actual Wasm runs parity traces and prepare/publish/discard checks. The worker connects Wasm to transactional IndexedDB in integration tests using fake-indexeddb. This does not establish real-browser or production-web cutover.
- Session client rejects stale/closed account responses; accepted writes and bulk operations drain in one queue. Dataset replacement advances the client generation and refreshes active queries. Generated TypeScript input/model contracts and an async workout/data API are available.
- History pages select dates before allocating set DTOs; cursors bind exercise, generation and revision. Snapshot tables use copy-on-write sharing. Untouched tables skip validation/diff/index reconstruction. Opening validates the complete snapshot and allocator. Set edits still clone/rebuild the set table and compute affected PRs; record-level updates and device performance measurements remain outstanding.

### Remaining acceptance work

1. Verify the mobile cutover on real devices: first launch after upgrade from the TypeScript store (with and without pending crash-log lines and restore points), a phone that already has an `engine.sqlite` from a WIP build, fast taps, edits, deletes, back navigation and interruption during pending commands. Known differences from the TypeScript store: the PR star appears one engine round trip after the tap, the conflict prompt's set count excludes planned sets, and the undo/daily slot rules come from Rust.
2. Remove the remaining `@lift/core` store code paths that only the web still needs once the web cuts over.
3. Add real-browser worker loading, verified legacy browser migration, origin-wide lock ownership and complete web screen integration.
4. Finish typed output DTOs/errors, selective query invalidation, cancellable bulk jobs, row-level storage/index updates and required failure/recovery cases.
5. Run release/device performance comparisons, Android runtime checks, complete offline end-to-end flows and final implementation review. Do not claim speedups from desktop or bridge tests alone.

Developer commands and measurement limits: `scripts/engine/README.md`.

## 1. Objective and boundaries

Move ownership of workout data and its business rules into Rust. Keep the mobile React Native interface, web React interface, and small platform adapters. Implement and validate mobile first while compiling and testing the portable engine for WebAssembly from the start.

The goal is faster, more predictable interaction and reliable persistence as histories grow. Moving code to Rust is not itself proof of improvement: measure complete user operations, including serialization, bridge transfers, React rendering, and disk writes.

### Ownership

| Owner | Responsibilities |
| --- | --- |
| Portable Rust | Domain models; workouts, exercises, sets, gyms and notes; planning/copy rules; validation; PRs; history and calendar queries; search; statistics; units and domain date rules; import/export transformation; snapshot format and migrations; backup and sync policy; AI context selection, response validation and plan application |
| Native Rust | Durable mobile storage, native file access, recovery, compression jobs, native database export, execution of the portable engine |
| Browser Rust/Wasm | The same domain rules and query engine, hosted in a Web Worker, with browser storage adapters |
| TypeScript | React components, navigation, themes, animation, temporary form state, optimistic presentation, query cache, transport adapters and AI provider HTTP integration |
| Swift/Kotlin | Expo bridge, OS lifecycle/background facilities, secure credentials, notifications, Live Activities, pickers and sharing |
| Existing Cloudflare service | Authentication, conditional snapshot storage, quotas and existing server protocol |

Presentation-only calculations such as chart pixel coordinates, layout geometry, relative-label formatting and live ticker repainting can stay in TypeScript. Persisted preferences live in Rust; consuming those preferences for rendering stays in React. Rust produces timer anchors and domain decisions, while platform code executes timer actions. Avoid crossing the language boundary every animation frame or timer tick.

HTTP can remain in adapters without keeping business rules there. Rust decides what to upload or how to apply a downloaded snapshot; adapters execute network effects and report results. Credentials remain in platform secure storage. A Rust server rewrite is outside this migration because it does not address the identified client bottlenecks.

## 2. Current implementation and migration implications

| Existing code | Finding | Planned replacement |
| --- | --- | --- |
| `packages/core/src/store/store.ts` | Singleton snapshot, synchronous mutations, synchronous React selectors | Engine session plus asynchronous command/query client |
| `store/mutations.ts`, `store/prs.ts` | Set operations copy/scan global arrays and recalculate affected histories | Indexed records, transactional commands, affected-exercise PR processing |
| `store/indexes.ts` | Table caches already exist, but changing sets rebuilds the set index | Incremental index maintenance |
| `store/blob.ts` | JSON and synchronous gzip on the JS thread | Rust codec running away from UI execution |
| `store/persist.ts` | Snapshot flush, operation replay, account isolation and replacement races | Rust persistence/session coordinator with explicit commit revisions |
| `mobile/src/store/storage.ts` | Base64 file boundary and read/rewrite pending log | Native binary I/O and transactional storage |
| `mobile/src/exports/fitnotesDb.ts` | SQLite compiled to JavaScript plus ZIP processing | Native Rust export job with SQLite and ZIP |
| `store/queries.ts`, `exerciseStats.ts`, `store/records.ts` | History object construction and derived statistics | Rust queries returning bounded result models |
| `import/`, `export/`, `ai/`, `sync/` | Shared TypeScript domain processing | Portable Rust modules with host effect adapters |
| `mobile/src/store/focusedStore.ts` | Covered-screen subscriptions are suppressed | Preserve focus-aware query subscriptions |
| `mobile/src/screens/SetLoggerScreen.tsx` | Optimistic rows, PR previews and deferred synchronous mutations | Command IDs, durable acknowledgements and query updates |
| `frontend/lib/store/` | OPFS/IndexedDB storage and browser session handling | Worker storage adapter preserving account isolation and writer coordination |

`localApi` currently returns promises around synchronous work, and many components bypass it through direct queries and `getState()`. Replacing `localApi` alone is insufficient. Inventory every direct import before switching ownership.

The existing code already optimizes PR calculation, import batching, table indexes and hidden-screen rendering. Preserve those gains. In particular, do not replace optimized TypeScript with a Rust implementation that repeatedly reconstructs the entire history.

## 3. Proposed repository layout

```text
Cargo.toml                         Rust workspace
Cargo.lock                        pinned dependency resolution
rust-toolchain.toml               pinned toolchain
crates/lift-domain/               portable types, rules, mutations, queries
crates/lift-codec/                snapshots, migrations, CSV/JSON, compression
crates/lift-engine/               sessions, commands, revisions, effect coordination
crates/lift-native/               mobile persistence and native binding surface
crates/lift-wasm/                 browser binding surface
packages/engine-client/           generated DTOs, async client, React query cache
mobile/modules/lift-engine/       Expo module, Swift/Kotlin wrappers, build hooks
frontend/lib/engine/              worker host, browser storage and client startup
tests/engine-parity/              shared fixtures and TypeScript/Rust comparisons
scripts/engine/                   bindings, builds, benchmarks and fixture tooling
```

Keep the number of crates practical; combine closely coupled modules if the initial build demonstrates no useful boundary. Native-only dependencies must not enter the portable dependency graph.

Proposed tools: Serde for data contracts, a portable gzip/ZIP implementation, a CSV parser, UniFFI for Swift/Kotlin bindings, and wasm-bindgen for browser bindings. Native SQLite is the preferred mobile persistence candidate. Pin versions only after a build spike verifies the repository's Expo, Xcode, Android NDK and browser targets. Do not assume that every Rust dependency supports Wasm.

## 4. Engine contract and concurrency

Use one authoritative engine session per signed-in account and one serialized mutation queue. Work executes on a dedicated native worker or browser Web Worker. A synchronous native function wrapped in a JavaScript promise is not sufficient: verify the actual execution thread.

Expose a small, versioned interface:

```text
openAccount(accountKey, options) -> SessionInfo
execute(sessionId, commandId, command) -> CommitResult
query(sessionId, query, minimumRevision?) -> QueryResult
subscribe(sessionId, queryKey) -> subscription
startJob(sessionId, job) -> JobId
cancelJob(sessionId, jobId)
closeAccount(sessionId) -> completion
```

Commands cover sets, workouts, exercises, gyms, notes, settings, copy/planning operations, imports, restore and AI plan application. Queries cover a workout/day, calendar month, paged exercise history, search results, statistics, restore points and sync status.

Every response carries a session identity and revision. The TypeScript client rejects stale account responses and prevents older query results replacing newer ones. Mutation acknowledgements include generated IDs, command ID, committed revision and affected query keys. Mutation success means the required durable write has completed; optimistic display is explicitly provisional.

Support command deduplication for retries, particularly rapid taps, lost acknowledgements and app interruption. Define retention and persistence for command IDs rather than assuming in-memory deduplication covers restarts. A retried command must not create another set.

Capture tap timestamps in the host and pass them into commands; queue latency must not change rest times. Inject clocks, IDs and timezone/date context for deterministic tests. Preserve JavaScript-safe integer IDs initially; if wider identifiers are later needed, use strings on the wire and migrate deliberately. Match existing rounding, null semantics, Unicode name normalization and date ordering explicitly.

Use typed DTOs and generated declarations, with a protocol-version handshake. Prefer narrow results and binary/file handles for bulk data. Never send the full snapshot after an ordinary set edit. Typed bindings still copy data in some cases; measure payload size and transfer time.

The engine publishes committed changes. React's external store holds immutable query results and UI state, not a second authoritative workout dataset. `useSyncExternalStore` reads this local cache synchronously; it must not initiate asynchronous Rust calls during render. Refresh queries through subscriptions/effects and invalidate only affected keys. Preserve stable unchanged results and focus-aware subscription behavior.

## 5. Storage and data compatibility

### Mobile

Prototype native SQLite transactions as the durable source of truth, with Rust indexes/caches built from it. Compare against a native append-log plus checkpoint implementation only if SQLite shows a material disadvantage in measured workloads. Prefer SQLite unless evidence justifies the extra recovery complexity of a custom log.

A command transaction must atomically update records, derived state that is persisted, revision, dirty metadata and retry identity. Update in-memory caches consistently with commit success; a failed commit cannot leave visible engine state ahead of durable state. Journal mode, sync policy and connection ownership need explicit testing on iOS and Android.

Backups use a consistent database snapshot or compatible logical snapshot; never copy a live SQLite file without accounting for its journal. Preserve previous, daily and pre-replacement undo semantics. The app's shutdown/background callbacks are best-effort, so ordinary writes must not depend on a final background flush for durability.

### Existing data

Keep the current gzip/JSON cloud snapshot protocol initially, independent of the new local database format. Existing clients must still exchange data without server changes. Preserve schema v1–v9 migration behavior, current schema protection, seed IDs, device IDs, timestamps, notes, planned sets, soft-deleted exercises and PR tie rules.

First-open migration:

1. Acquire exclusive ownership of the account store.
2. Read existing snapshot candidates and pending operations without modifying originals.
3. Reject unsupported future schemas; distinguish corruption from newer data.
4. Migrate, replay and repair in a staging engine. Compare counts and normalized contents.
5. Write the new database transactionally, reopen it and verify semantic equality.
6. Atomically record which engine/store is active only after verification.
7. Keep the original files and a migration backup until the retention policy allows removal.

Legacy recovery has limits: `persist.ts` currently treats `copy_from` and `recompute_prs` pending entries as no-ops, relying on the snapshot. Rust must not promise reconstruction of changes whose complete inputs were never logged. Preserve the source files, match documented legacy replay semantics and distinguish recoverable records from unrecoverable missing operation data in migration diagnostics. Freeze seed IDs and their meanings from the existing catalog; reordering a generated seed list must not renumber exercises.

A crash at any step must resume or retry without duplicating records or making an empty store active. Account switches, username changes and sign-out must retain current isolation rules.

Rollback cannot simply reopen the old files after Rust has accepted new edits. Before activation, failures may return to the untouched old store. After activation, rollback requires a compatible export containing all new edits and a verified reverse handoff. Do not silently fall back to stale TypeScript storage when native initialization fails.

### Web

Run Wasm inside a dedicated worker. Keep browser storage behind an adapter using existing OPFS/IndexedDB capabilities. Define durable command acknowledgement, ordered operations, checkpoints and recovery for that adapter; IndexedDB transactions must not remain open across arbitrary asynchronous work. Preserve the current single-writer policy through Web Locks and handle worker crashes and browser quota failures.

Preserve the exact origin-wide lock name `lift:store-editor` from `frontend/components/store/StoreOwner.tsx`. Acquire it before migration/hydration or sync, and hold it until accepted writes drain and the worker/session closes. Do not substitute a per-account or worker-specific lock while older tabs can exist. Test an old tab holding the lock, a new tab waiting, takeover after close/crash, and auth changes while waiting. This coordinates simultaneous writers; it does not make an old tab understand the new storage format. Browser rollout must also require old tabs to close/reload before using migrated storage; treat stale-client re-entry as a downgrade scenario, not a guarantee supplied by Web Locks.

A native SQLite dependency is not required in the shared domain engine. Browser SQLite can be evaluated separately; do not delay mobile improvements or force identical storage to achieve shared business logic. Start with a single worker, avoiding a shared-memory threading requirement and its additional hosting constraints.

## 6. Implementation sequence and acceptance gates

### Stage 0: baseline and behavior inventory

- Run the existing Vitest suite and package typechecks; record pre-existing failures.
- Map direct store/query imports in both clients, including settings, rest timer and AI flows.
- Create synthetic datasets with 1k, 10k, 50k and 100k sets, plus concentrated single-exercise histories.
- Measure release builds: startup, save/edit/delete, history, statistics, import/export, snapshot processing, memory and frame stalls.
- Record normal, large and pathological cases separately. Use synthetic fixtures in CI; keep personal exports local.

Exit: reproducible baseline and a behavior matrix linked to existing tests. This stage produces measurements, not speedup promises.

### Stage 1: build and bridge proof

- Install/pin Rust and required target toolchains. Rust was not available on PATH during the planning inspection.
- Compile one portable crate for desktop tests, iOS device/simulator, Android device/emulator and Wasm.
- Build an Expo module following the repository's local-module pattern; prove a long Rust task does not block JS interaction.
- Prove typed results, binary handling, errors, job progress, cancellation and account session disposal.
- Run the same operation in a browser worker.
- Extend GitHub and EAS build paths so clean `expo prebuild` does not discard integration.

Exit: installable development builds on both mobile platforms, working worker integration, and measured bridge overhead. Validate UniFFI before committing the full API; use a narrower native binding approach if the spike reveals compatibility issues.

### Stage 2: portable domain and compatibility codecs

- Port schema, seeds, IDs, normalization, units, validation, date rules and snapshot migrations.
- Port PR calculation and prediction, records, history, statistics, search and calendar queries.
- Port mutations with cascade semantics and deterministic batch behavior.
- Implement legacy snapshot read/write and import/export transformation.
- Build a command-trace harness comparing the old engine and Rust after each operation.

Exit: semantic parity on existing fixtures and randomized operation sequences across native Rust and Wasm. Keep the current TypeScript engine as a test oracle during migration. Explicitly review genuine existing bugs instead of silently changing behavior under the port.

### Stage 3: native persistence and engine ownership

- Implement native account sessions, transactions, indexes, query invalidation and retry handling.
- Add staging migration, recovery, previous/daily/undo copies and account teardown.
- Implement snapshot production on a background worker from a consistent committed revision.
- Test disk-full, interrupted writes, corrupt snapshots, interrupted migration and concurrent sign-out/restore/sync.

Exit: durable set commands survive process termination, migrations are repeatable, and no account can receive another account's results or writes.

### Stage 4: mobile application cutover

- Introduce `engine-client` and typed React query hooks.
- Migrate bootstrap, StoreProvider, settings and account lifecycle.
- Migrate day/calendar/exercise screens, then the set logger, history and statistics.
- Replace synchronous `getState()` access and direct mutation calls at every production call site.
- Reconcile optimistic set rows by command ID; rollback failed changes with a retryable UI state.
- Move PR prediction into the engine where it can use indexed data. If preview is delayed, render a pending badge rather than maintaining a duplicate PR algorithm in React.
- Keep timer feedback immediate using tap-time anchors; reconcile failures with committed engine state.
- Virtualize the exercise detail history list so rendering does not erase the data-engine gain.

Exit: a complete offline workout flow uses Rust as the only writer and data owner. No full-history mirror in React. Cover fast taps, edits, deletes, back navigation, screen focus and interruption during pending commands on real devices.

During implementation, select one whole engine per account session in development builds. Do not split production mutation ownership across TypeScript and Rust or dual-write two live stores.

### Stage 5: complete data workflows

- Wire CSV/JSON import preview and commit to Rust jobs with progress and cancellation before commit.
- Implement native FitNotes database export, preserving the skeleton's schema and ID conventions.
- Port backup policy, restore and recovery interfaces.
- Port sync state decisions and effects while preserving ETags, device retry semantics, quotas, cooldown and preview behavior.
- Bind uploads to the revision they serialize; a successful older upload must not clear newer local dirty state.
- Port AI context/plan validation/application. The current implementation can leave partial writes within a failed day. First capture that behavior in parity fixtures. Proposed improvement: one transaction per accepted day, with explicit tests and a documented behavior change; do not describe this as exact parity.
- Move domain settings, search, planning and remaining business helpers out of TypeScript.

Exit: all current user data workflows work through Rust. A failed/cancelled bulk operation has a defined transaction boundary, and sync replacement cannot overwrite newer local work unnoticed.

### Stage 6: connect the web app

- Load Wasm only in the browser worker; keep it out of server-render execution.
- Implement the storage/effect adapter and account session coordination.
- Reuse `engine-client` DTOs/hooks and migrate web direct store imports.
- Add loading/error states, worker restart behavior and compatible asset caching.
- Validate Next.js worker/Wasm packaging using the repository's installed Next documentation before implementation.
- Test fresh install, existing store upgrade, multiple tabs, offline reload, quota failure and outdated cached assets.

Exit: browser and mobile produce equivalent results and exchange compatible snapshots. Web limitations remain in web adapters, with native facilities available to mobile.

### Stage 7: optimization, rollout and retirement

- Compare against Stage 0 on the same devices and fixtures.
- Optimize measured hot paths: index updates, PR caches, date parsing, query materialization and bridge transfer sizes.
- Retain full recomputation as a correctness oracle for incremental PR updates, especially historical edits/deletes.
- Gate release on correctness, persistence and end-to-end performance; investigate startup/binary-size tradeoffs rather than assuming every metric improves.
- Remove unused production TypeScript engine paths, dependencies and compatibility shims after both clients pass.
- Keep reusable fixtures and historical format readers. Update development/install docs and native build troubleshooting.

Exit: no production TypeScript workout engine, reproducible native/web builds, documented upgrade/recovery behavior, and measured results.

Dependency order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Codec/domain modules can be developed independently inside Stage 2; application ownership switches only after persistence and parity gates pass.

## 7. Verification matrix

| Area | Required checks |
| --- | --- |
| Domain parity | Existing `mutations`, `queries`, `prs`, `prsParity`, `predictPrFlags`, `records`, `units`, `setLogger`, `exerciseStats`, seed and shared-helper behaviors |
| Imports/exports | CSV/JSON round trips, Unicode names, same-date merging, gym case rules, deleted/built-in exercises, malformed files, FitNotes DB contents |
| Recovery | Existing `blob`, `persist`, `restorePoints`, `snapshotRotation`, `accountStore`, `signOut` and browser recovery cases, plus native crash injection |
| Sync | Existing ETag, own-write retry, remote preview and clock tests; edits during upload/download; account changes during requests |
| Native boundary | Binding error propagation, background execution, session disposal, binary ownership, cancellation and no panic crossing FFI |
| Browser | Real worker and browser tests, OPFS/IndexedDB behavior, Web Locks, multiple tabs, Wasm asset caching |
| UI | Actual mobile and web smoke flows; focused subscriptions; optimistic reconciliation; rendering and animation stalls |

Add Rust unit/property tests, cross-language fixture tests and real device/browser integration tests. Avoid substituting desktop Rust microbenchmarks for phone measurements. Normalize only intentional nondeterminism in parity comparisons; inject clocks/IDs wherever possible. Compare semantic decoded snapshots rather than gzip byte identity.

CI should run formatting, Clippy, Rust tests, native/Wasm compilation, DTO drift checks, TypeScript checks, parity tests and existing Vitest tests. Native build workflows compile/link Rust before packaging. Cache by toolchain, target and lockfile. Generate bindings from the same locked build as the native library. Changes to native engine binaries require an app rebuild; an incompatible JavaScript OTA update must fail the protocol handshake clearly.

## 8. Performance acceptance

Track median and tail latency, peak memory, JS stalls, native worker queue time, bridge bytes, startup time and artifact size. Separate optimistic visual response from durable command completion.

Initial target: ordinary set commands should not introduce a JS task exceeding a 60 Hz frame budget (~16.7 ms); this is a target to test, not a guaranteed property of Rust. Bulk jobs should leave navigation and progress responsive. Establish durable-write and startup thresholds from the baseline and target hardware rather than choosing unsupported absolute numbers.

Report each feature as improved, unchanged or regressed. A backend speedup that is lost to copying or UI rendering does not pass as a user-visible improvement. Also measure browser download/initialization cost and low-end Android performance.

## 9. Decisions and completion definition

Settled direction: Rust owns workout data; mobile first; shared portable engine; asynchronous UI boundary; small query results; platform-specific storage/execution; existing server and wire protocol initially.

Decisions resolved by the initial spikes: exact binding versions, native packaging, SQLite tuning, byte-transfer strategy, browser persistence implementation and performance thresholds. These are engineering investigations, not reasons to pause every stage for approval.

Complete means all agreed domain/data workflows execute in Rust, mobile and web have working adapters, legacy data migrates safely, backup/sync compatibility is demonstrated, no competing JS data engine remains in production, and performance results and remaining tradeoffs are documented. A Rust crate that is only tested from the command line or a native module with no production callers is not a completed migration.

References: [Rust browser-target constraints](https://doc.rust-lang.org/stable/rustc/platform-support/wasm32-unknown-unknown.html), [UniFFI](https://mozilla.github.io/uniffi-rs/next/), [Expo native code](https://docs.expo.dev/workflow/customizing/), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers). Verify current APIs against pinned dependencies during Stage 1.

## 10. Detailed design contracts

The following decisions make the stages implementable. They are proposed contracts, not descriptions of functionality already present.

### 10.1 Portable transaction model

The portable domain must not depend on SQL queries, native filesystem calls, React, or browser APIs. Its working data is indexed Rust state. A command produces a prepared change containing record inserts/updates/deletes, derived changes, invalidation keys, result data and a base revision. Preparation must not mutate committed state.

Use the same sequence on both platforms:

1. Admit a command for the current account/session and check its retry identity.
2. Validate inputs and any explicit precondition against revision R.
3. Prepare a change from R, including allocated IDs, PR changes and metadata.
4. Persist the change and command receipt atomically, conditional on R still being current.
5. Publish revision R+1 to Rust's visible state, then notify subscribers and return the receipt.

Native storage executes step 4 in SQLite. The browser host executes it in an IndexedDB transaction or a separately proven OPFS commit protocol, then calls the worker's completion entry point. No other mutation may overtake a prepared commit while storage awaits. Read-only queries can use committed revision R; never expose prepared state.

If storage definitely fails, discard the prepared change. If commit outcome is unknown, reopen/reconcile against durable revision and receipt before accepting more mutations. If persistence succeeds but publication fails, rebuild memory from durable state; do not report a definitive rejection that encourages a duplicate command. A process crash between steps 4 and 5 is recovered by the persisted receipt.

This avoids placing an asynchronous browser I/O call inside a synchronous domain mutation or holding an IndexedDB transaction across Wasm work. The storage adapter interface needs `load`, `commit(expectedRevision, preparedChange)`, `lookupReceipt`, `checkpoint`, and replacement/recovery operations, with conformance tests shared across adapters.

### 10.2 Initial native tables and indexes

| Table | Content / index requirements |
| --- | --- |
| `engine_meta` | Local schema version, dataset generation, committed revision, ID high-water mark, migration identity |
| `exercises` | Preserve seed override and soft-delete semantics; seed catalog itself is bundled and versioned |
| `workouts` | Existing fields; date lookup; enforce one workout/date only after legacy normalization |
| `workout_exercises` | Workout and exercise references; indexes by workout/order and exercise |
| `sets` | Existing fields; index by workout-exercise/order/id; no global sets-array rebuild per edit |
| `gyms`, `day_notes`, `settings` | Preserve case/name rules, date keys, defaults, custom category metadata and unknown compatible settings |
| `command_receipts` | Retry identity, payload digest, generation, revision and result |
| `sync_meta` | Last adopted ETag, last successful sync time, exported/synced revision and conflict state |
| `restore_catalog` | Restore-point identity, generation, counts, creation time and verified file reference |

Do not add foreign keys that reject valid existing implicit seed exercises. Inventory orphan handling in legacy imports before enforcing referential constraints. IDs currently come from a snapshot-wide monotonic counter, not a device-global UUID scheme. Preserve this initially; whole-snapshot sync does not require a new multi-device row-merge algorithm.

Keep persisted PR flags for compatibility if useful, but treat them as derived. Persist an algorithm version and recompute when required. Index updates should be proportional to affected records. Store both current and historical record semantics; deleting a record or editing an old date can require a full affected-exercise pass.

### 10.3 Revisions, generations and retry identities

Separate four versions: binding protocol version, local storage schema, legacy export schema, and PR/domain algorithm version. A compatible export version does not imply an old native binary can read a new database.

Also distinguish account identity, session identity and dataset generation. Closing/reopening an account creates a new session. Restore/replace creates a new generation. Local revisions increase within the active dataset; query caches and receipts include generation so they cannot collide after replacement.

A command ID represents one intended action. Two deliberate Save taps receive two IDs even if weights/reps match. A transport retry reuses the original ID and payload digest. Reusing an ID with different input is an error. Persist receipts with the command transaction. Initially retain receipts for the active dataset rather than inventing an unsafe expiry period; a later bounded retention scheme must include a protocol that rejects expired retries instead of executing them again.

After restore, reject retries targeting an old generation. Recover the outcome of an accepted command through a receipt lookup; an unknown outcome is different from a validation failure. Add receipt status to the public API before implementing UI retries.

### 10.4 Errors and lifecycle

Use structured error codes with safe details: validation failure, missing entity, stale session, stale generation, conflicting revision, unsupported protocol/schema, storage unavailable/full, corrupt data, network failure, quota refusal, cancelled job and unknown commit outcome. Include retryability and field errors where meaningful. Logs must not contain tokens, AI keys or complete workout exports.

Session states are `closed → opening → migrating/recovering → ready → closing → closed`, with explicit failure states. Reject new commands during closing; drain accepted commits or report their outcomes before releasing storage ownership. Invalidate callbacks and subscriptions before the next account becomes visible. Late HTTP, export, timer and query results carry session identity and cannot act on a replacement session.

Native panic handling must invalidate the affected engine safely; do not catch a panic and continue with possibly inconsistent state. A caught binding error and a recoverable domain error are different cases. Browser worker death discards pending query results, reopens durable state and reconciles command receipts.

## 11. Screen queries, caching and user interaction

### Query inventory

| Screen/workflow | Engine result |
| --- | --- |
| Today/day | One workout and its sets, date note, gym, timer anchor and relevant settings |
| Calendar | One month's markers/plans plus selected-day detail fetched separately |
| Exercise picker | Filtered/paged exercise results, usage counts and last-performed metadata |
| Set logger | Current exercise/session, last-session summary, relevant records and validated prefill inputs |
| History | Bounded page of sessions with notes and sets |
| Graph | Metric points for requested exercise/range; pixel coordinates remain in UI |
| Summary | Aggregated records and summary values, not every historical set |
| Settings/recovery | Preferences, store counts, sync state and restore-point summaries |

Start with capped history pages (for example 30 sessions) and a bounded search result count. These are initial product-neutral implementation limits, to tune after measurement. Include continuation cursors containing generation, query/filter identity, ordering key and revision. Define stale-cursor behavior: return an explicit restart indication after relevant edits rather than silently skipping/duplicating rows across pages. Order by stable date/entity keys, including ties.

Cache keys include account, generation, query kind, arguments and domain-relevant unit/date context. Bound cached pages by an LRU policy; release subscriptions on unmount. Cache results retain their revision. A mutation invalidates only affected keys, including historical pages whose PR flags changed, exercise usage, day/calendar counts, timer anchors and summaries.

Subscribe before the initial query or atomically return a revision with subscription establishment. Otherwise a commit between initial read and subscription can be missed. Sequence events; a detected gap triggers requery. Coalesce invalidations under load and cap progress/event queues. A slow screen cannot block persistence or grow native memory indefinitely.

Optimistic UI stores command ID, input and presentation state only. A new workout/exercise plus its first set should be one command so temporary parent IDs need not become authoritative React state. A pending set can be edited/deleted only through a defined dependent-command queue or after acknowledgement. Navigation does not cancel accepted mutations. Screen unmount removes presentation subscriptions, not writes.

The existing set logger uses queued PR previews and animation deferrals. Remove delays that only compensate for synchronous JS work after profiling confirms the Rust path is responsive. Retain animation behavior that is part of the UI. A predicted PR is provisional; the committed result wins. OS timer failure never rejects a committed workout set. Timer actions are ordered and reconciled by session and command identity so a failed early tap cannot erase a later successful timer.

## 12. Jobs and external effects

Large jobs have `queued`, `running`, `ready_to_commit`, `committing`, `completed`, `cancelled` and `failed` states. Report stage and processed/total counts only when total is known. Cancellation is cooperative during parsing/computation; once a durable commit starts, return its actual outcome rather than claiming it was cancelled.

Native CPU-heavy jobs should not occupy the interactive command executor for their entire duration. Prepare against a stable revision on a worker, then check the base revision before commit. Import previews are bound to a content digest and generation. If the dataset changes between preview and apply, recompute merge decisions or request a new preview; do not apply a stale delta. Whole-store replacement requires an explicit generation/revision precondition.

The browser's single Wasm worker also needs yielding/chunking for long jobs: merely moving work off the UI thread does not keep engine commands responsive. If incremental processing proves impractical, use a separate job worker with an immutable input, then validate its result at commit. Budget for duplicated memory before choosing that approach.

Exports run against a consistent revision and label that revision internally. Mobile passes app-owned file handles/URIs through a staging adapter; picker content URIs and security-scoped files cannot be assumed to be ordinary Rust paths. Web uses transferable buffers or chunked input. Define size/expansion limits for gzip/ZIP, malformed UTF-8/CSV handling, temporary-file cleanup and finite numeric validation. Parse errors must leave the active dataset intact.

Sync effects carry an effect ID, account session, generation, source revision, ETag precondition and device identity. Recheck these when an HTTP result returns. A push of R followed by a local edit to R+1 may update the adopted server ETag but must preserve pending local changes. Previewing remote data must not adopt its ETag. Pull replacement must preserve the latest outgoing undo snapshot and refuse a stale replacement decision. Keep full-snapshot conflict resolution; automatic row merging is a separate product change.

AI provider requests stay in adapters. Rust produces bounded context and parses/validates responses without receiving stored credentials. Resolve names, units, dates and planned-set flags through the same domain rules as manual edits. Atomic per-day application is a proposed behavioral improvement and needs its own regression fixtures covering what succeeds and what rolls back.

## 13. Migration and downgrade drill

Track a migration manifest with account key, source format, input digest, staging location, phase, target schema and verification result. Store activation metadata where startup can resolve it without guessing which directory is newest. A verified Rust store plus an absent activation record must be distinguishable from an incomplete migration.

Test process termination after source read, after each durable staging step, before activation, after activation and before original-file cleanup. Test missing/corrupt newest snapshots, valid backups, pending logs, future schemas, renamed accounts and interrupted undo creation. Compare full normalized domain contents, not just counts.

Old application binaries do not know the new activation marker. Retaining old files therefore does not make arbitrary app downgrades safe: an old binary could open stale history and later push it. Document that downgrade requires a verified compatibility export/reverse handoff before installing the older app. Do not promise a transparent downgrade or maintain an untested dual-write mirror. Rehearse the handoff in a disposable account before release.

Restore points created before migration remain readable and visible through a legacy backup reader until their normal retention expires. Replacement creates a new dataset generation and invalidates query caches, jobs and relevant retry state. The manifest and restore catalog must never make an incomplete backup appear usable.

Restore metadata is operation-specific:

- Local backup/undo restore: create a new generation, mark the restored dataset locally dirty and retain the currently adopted remote ETag so the next push remains conditional. This explicit dirty-state behavior is a proposed correction to the current shared replacement path, which can clear dirty state; test and document the change.
- Remote pull replacement: adopt the downloaded ETag and synced revision only after the corresponding data replacement commits. A failed replacement leaves the previous adopted sync state intact.
- Neither path reinstates historical `sync_meta`, command receipts, account identity or session identity merely because they appear in a database backup. Restore domain data through the replacement transaction and construct current control metadata deliberately.

Add tests for restore followed by conditional sync, a server update between restore and push, failed remote replacement, repeated undo, stale command retry after restore, and a database backup carrying obsolete ETags/receipts. Keep the current daily-slot hold and protection against repeatedly overwriting the useful undo copy.

## 14. Build, packaging and delivery work items

| Work item | Concrete changes / evidence |
| --- | --- |
| Workspace bootstrap | Root Cargo workspace/lockfile/toolchain; target-aware scripts; ignored generated binaries |
| iOS integration | Device arm64 and Apple Silicon simulator builds; static library/framework packaging and generated Swift; module podspec linking; verify clean CocoaPods/prebuild builds |
| Android integration | Pin compatible NDK; build arm64 device and x86_64 emulator libraries initially; JNI/generated Kotlin integration; additional ABIs only if the app ships them |
| Expo integration | Local module registration, dependency/autolinking configuration, TypeScript facade and runtime availability/protocol checks |
| GitHub builds | Add Rust setup/compilation to existing iOS/Android workflows before their native link steps; preserve existing unsigned iOS packaging and Android installation workflow |
| EAS builds | Ensure workspace crates are included in uploaded sources; install required toolchain or consume reproducible target artifacts; test cloud build from a clean checkout |
| Web | Generate Wasm/JS bindings; worker asset bundling, MIME/CSP validation and versioned cache invalidation; browser-only initialization |
| Tests | Extend `.github/workflows/test.yml`; build and test Wasm as well as native Rust; separate compile gates from device runtime tests |
| Developer workflow | Document Rust installation, native rebuild vs. TypeScript refresh, symbols/logging, fixture generation and benchmark commands |

Generate protocol DTOs from a single declared source with explicit enum tagging and optional/null semantics. UniFFI does not by itself produce the entire Expo-to-TypeScript contract; implement and test that mapping. Add generated-file drift checks and contract fixtures through both actual adapters.

Test unsigned IDs, safe numeric ranges, Unicode strings, byte arrays, errors and callbacks through Swift/Kotlin and browser bindings. Add resource ownership tests: closing a session releases native handles and worker buffers; JS reload/React StrictMode cannot leave competing engines open.

All supported targets must compile before feature work accumulates behind a platform-specific dependency. Native release artifacts need symbols retained for diagnosis and identical generated bindings/library versions. The current iOS workflow chooses the newest installed Xcode; record the selected version in artifacts so builds remain diagnosable even when that runner changes.

## 15. Reviewable implementation slices and release evidence

Use small reviewable changes inside the stages rather than one repository-wide replacement:

1. Baseline fixtures, measurements and call-site inventory.
2. Workspace, cross-target build and binding round-trip proof.
3. Domain types/normalization and snapshot compatibility readers.
4. PR/query/statistics parity, then mutation parity.
5. Portable commit protocol plus native/browser adapter conformance harness.
6. Native storage, migration manifest and crash-recovery tests.
7. Typed client/query cache and one complete mobile vertical slice.
8. Remaining mobile screens and account lifecycle cutover in development builds.
9. Imports/exports, backups, sync, AI and timer reconciliation.
10. Web worker/storage/UI cutover.
11. Performance tuning, release rehearsals and removal of production TS engine paths.

The vertical slice is a test/development milestone, not permission to ship two writers: incomplete Rust builds must not expose production workflows still writing through the old store. Mobile release requires Stage 5 completeness, independent of when web cutover ships. Old web clients can coexist using the compatible snapshot protocol.

For each slice attach commands run, target/toolchain versions, parity results, deliberate behavior changes and unresolved failures. The final release evidence includes real-device save/restart tests on iOS and Android, real-browser worker/storage tests, legacy upgrade and reverse-handoff rehearsals, mixed old/new-client sync, and before/after benchmark results.

Benchmark with warm-up plus repeated samples, cold and warm startup separately, consistent build optimization/device state, and p50/p95/p99 where sample count supports them. Record OS, dataset shape, engine revision and raw samples. Instrument command admission, preparation, persistence, publication, bridge delivery and React paint so regressions can be attributed. Limit diagnostics to timings/counts/identifiers without personal content.

Final retirement audit: search both clients for direct snapshot/store/index imports; categorize every remaining use; remove production PR/import/mutation copies; keep only explicitly named test oracles as needed. Ensure the provider, settings, rest timer, sync and background jobs all use the same active session. A successful Cargo test run alone cannot satisfy this audit.

## 16. Independent design review

An independent agent reviewed the expanded plan against the repository. Its findings were incorporated: stable seed references, limits of legacy pending-log replay, cooperative browser job execution, preservation of the existing browser lock namespace, and separate restore-versus-cloud sync metadata rules. The reviewer reported no other blocking architectural contradiction in the reviewed design. This is a planning review; platform builds, data safety and performance remain subject to the implementation gates above.
