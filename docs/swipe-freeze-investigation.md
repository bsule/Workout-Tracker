# Delete followed by a quick swipe

The local simulator's existing `/tmp/metro.log` captured repeated stalls after
single-set deletion, before this change:

| Delete completion (log-relative ms) | Store mutation | Next JS frame gap |
| --- | --- | --- |
| 357989 | 1 ms | 311 ms |
| 358756 | 1 ms | 297 ms |
| 360172 | 2 ms | 326 ms |
| 361339 | 1 ms | 298 ms |
| 362455 | 1 ms | 286 ms |

These are development-simulator measurements, not release-device benchmarks.
The store timing excludes the subsequent React renders. The logger's own
render/commit measured 46–54 ms in these examples; substantial work also
occurred outside that interval. Drag-start and release callbacks sometimes
arrived together after the stall. Legacy Swipeable tracks dragging natively,
but dispatches its release spring from JavaScript, so blocked JS delays release.

## Why the earlier freeze did not isolate the logger

In the installed `@react-navigation/native-stack` implementation,
`NativeStackView.native.tsx` computes `shouldFreeze` on Fabric with
`!isFocused && !isBelowFocused` (plus preload/modal guards). Consequently,
`freezeOnBlur: true` does **not** freeze the route immediately below SetLogger.
The app eagerly mounts every bottom tab, whose whole-snapshot subscriptions
invalidate lists and calendar pages on every set mutation. Covered stack
screens also retained their subscriptions.

`useScreenSnapshot` now gates notifications and snapshot reads on navigation
focus, including parent navigator focus. Covered screens keep their last
snapshot and catch up from the live store on focus. This avoids scheduling
hidden React work instead of moving the delete to another arbitrary timeout.
App-level settings, persistence and sync keep their existing subscriptions.
The swipe implementation, thresholds, springs and delete animation are unchanged.
Selected-set deletion also calls the existing bulk mutation once instead of
repeating PR calculation for each selected set.

## Saving

Deleting records a small `delete_set` crash-log operation. Full snapshot
serialization/compression is debounced for 30 seconds, or forced by lifecycle
events. It is not called by the immediate delete path. Snapshot serialization
can still block JS separately; this change does not claim to eliminate that
or every other possible source of dropped frames.

## Verification

`tests/focusedStore.test.ts` exercises real store mutations: visible subscribers
update, hidden subscribers receive no notifications, incidental hidden reads
remain stable, and focus catches up without another mutation. It also covers
mount/subscription races, repeated focus cycles and cleanup/resubscription.

All 501 tests and the mobile TypeScript check passed. Automated native gesture
verification was unavailable: the simulator debugger connection closed and the
computer-use tool could not access the simulator. Post-change gesture latency
has therefore **not** been measured.

On a device, open the logger from Today, Calendar and an exercise-history route.
Delete a set and immediately swipe another, repeating with several rows. Verify
that release starts promptly and that returning to each underlying screen shows
the deletions. Also test multiple selected sets, navigating back during a row's
exit animation, and reopening after a save. Existing `[swipe-dbg]` development
logs provide comparable mutation, render and JS-frame timings.
