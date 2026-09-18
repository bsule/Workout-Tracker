# Position scoped top weights in the set logger

Date: 2026-09-17
Scope: `mobile` and `packages/core`. The web client has no equivalent card, so it is untouched.

## Summary

The mobile set logger shows a "Last time" card under the set list. Today the card
has one job: it shows the previous session's sets and the top weights for the whole
exercise. After the first set of the day it collapses to a single line.

This change gives the card a second mode. Once the day has a logged set, the card
drops the previous session block. It then shows the top weights for the set position
the user is about to log. After one set it shows set 2. After two sets it shows set 3.

## Key takeaways

1. The card has two modes. One input picks the mode: `nextPosition`.
2. `nextPosition` comes from the screen's own `sets` array, not from `history`.
   `history` lags the click frame by a full store commit.
3. Position mode has a fixed height. A position to position swap does no layout work.
4. Only the first set of the day changes the card's height. That path already has a
   230 ms mutation deferral. Sets 2 and later need no deferral at all.
5. Position means the same thing here as it does in `prs.ts`. The card and the `2PR`
   badges must never disagree.

## Current behaviour

`LastTimePanel` lives in `mobile/src/screens/SetLoggerScreen.tsx`.

- Open state: previous session chips, a rule, then `topRepRecords(days, 3)`, then a
  "Show more" link to the Summary tab.
- `topRepRecords` returns the best weight at each rep count, heaviest first, across
  every set of the exercise. Ties go to the harder set. Weights compare through
  `weightKey`, never as raw floats.
- `open = manual ?? (!hasSets || !last)`. The first logged set collapses the card.
- The body is two stacked layers inside one box. The box height eases between their
  measured heights. The animation runs on the JS driver, because height is a layout
  prop.
- That height animation cannot survive a busy JS thread. The save path therefore holds
  the store mutation back by `LAST_TIME_COLLAPSE_MS + 40`, which is 230 ms, on the
  first set of the day. Later sets pay nothing.

## Design

### 1. Data layer

Add `position: number` to `HistorySet` in `packages/core/src/types/index.ts`.

`getExerciseHistoryQ` in `packages/core/src/store/queries.ts` fills the field. It uses
the rule `recomputePrsForExercise` already uses: the 1 based index in the order sorted,
non planned set list of one `workout_exercise`. The query assigns positions per
`workout_exercise`, before it merges two same date rows into one
`ExerciseHistoryDay`. A day index is not a position, because the same exercise can
appear twice in one day.

This is a view model type. It is not part of `Snapshot`. Do not bump `SCHEMA_VERSION`.

Move `topRepRecords` from the screen into core. Give it an optional position filter:

```ts
topRepRecords(days, limit, opts?: { position?: number })
```

With no `position` the function behaves exactly as it does today. With a `position` it
first filters to sets at that position, then applies the same best per rep count rule.

Memoise a `Map<position, records[]>` in the panel, keyed on `days`. This builds every
position in one pass. Without it, each swap rescans the whole history.

### 2. Two modes, one input

The card's mode is a function of `nextPosition` alone.

**`nextPosition === 1`** is last time mode. The day has no logged set. The card is
unchanged from today: header reads "Last time" with the ago label, the chevron, and the
calendar button. The body holds the chips, the rule, the overall top weights, and
"Show more".

**`nextPosition >= 2`** is position mode. The header reads `SET N TOP WEIGHTS` and keeps
the chevron. The ago label and the calendar button leave with the chips, because all
three describe the previous session. The body holds the position filtered records.

The chevron still collapses the card in both modes. The automatic collapse at the first
set is gone. The first set now switches mode instead.

### 3. Deriving `nextPosition`

`nextPosition` is derived in the screen and passed to `LastTimePanel` as a prop. It
counts non planned sets in `sets`, plus the optimistic row, plus one.

It must not be derived from `history`. `history` is a `useMemo` over `snapshot`, and the
snapshot only changes when the store mutation commits. On the first set that commit is
deliberately 230 ms late. Reading `sets` instead makes the card swap on the click frame,
on the same frame as the new row's fade in.

Two save paths feed the count, and they behave differently:

- **Plain add.** `pendingAdd` holds an optimistic row that is not in `sets` yet. Count
  it as one extra logged set while it is live.
- **Logging against a planned set.** `logPlannedSet` flips `optimisticLogged` and runs
  the mutation at once. There is no `pendingAdd`. The row is already in `sets` as
  planned, and it flips to non planned when the commit lands. A plain "+1 while
  `optimisticLogged`" over counts after that commit. Track the id being logged instead,
  and count it as logged only until `sets` reports it non planned.

Freeze `nextPosition` while `editingSetId != null`. Editing an existing set does not
change what comes next. A card that jumps when the user taps a row reads as a bug.

### 4. Fixed height

Position mode always renders three row slots at a fixed row height. Fewer records leaves
the remaining slots empty. The empty state line renders inside the same three slot box.

Every position mode variant is therefore the same height. A swap from set 2 to set 3
changes no layout. This is what makes the per set path cheap.

### 5. Animation

Four states now exist: last time open, last time collapsed, position open, position
collapsed.

The current two layer trick assumes exactly two layers and interpolates a 0 to 1
progress between their measured heights. Generalise it. Keep a measured height per
layer. Ease a single `Animated.Value` that holds the raw height toward the active
layer's height. Cross fade the layers by opacity. This is less code than the current
interpolation, and it scales to four states.

Animation budget per event:

- **Mode switch at set 1.** One height change per session, on the JS driver. Keep the
  existing `LAST_TIME_COLLAPSE_MS + 40` mutation deferral unchanged. It exists for this
  exact animation.
- **Set 2 and later.** No height change. Fade the row block out and in on the **native
  driver**, roughly 140 ms, keyed on position. The native driver is not blocked by the
  PR recompute, the index rebuild, or the list re render. Sets 2 and later therefore
  need no mutation deferral, and the save path stays as fast as it is today.
- **Chevron collapse.** Now a rare deliberate tap rather than a per set event. Its JS
  driver height animation is off the hot path.

### 6. Empty position

A user who normally does three sets has no history at position 4. Position mode then
shows an empty state line in place of the rows: "No record yet for set 4." The height
does not change, because the line sits in the same three slot box.

The card does not fall back to the overall top weights, and it does not hide itself.

### 7. Edge cases

- **Cardio.** `topRepRecords` returns nothing for a cardio exercise. The current guard is
  `!last && top.length === 0`. That guard no longer covers position mode, where an empty
  box would render. Add an explicit guard on `exercise.kind !== "weight_reps"`.
- **Deletes.** `nextPosition` moves back on its own. It reads the same `sets` array the
  list reads, so the existing `leavingIds` fade needs no change.
- **Planned sets.** Excluded from the count and from the history buckets. This matches
  `prs.ts`.
- **Same exercise twice in one day.** Positions restart per `workout_exercise`. The
  second block is 1, 2, 3 again. This matches the `2PR` badges on the same screen.
- **Settings.** `show_last_time` still gates the whole card in both modes. Its doc
  comment in `packages/core/src/types/index.ts` describes only the old behaviour. Update
  it.

## Testing

The mobile UI has no automated tests. Moving the logic into core is what buys coverage.

Add to the core suite:

- `getExerciseHistoryQ` assigns position per `workout_exercise`.
- Planned sets do not take a position.
- Two `workout_exercises` on one date restart positions at 1.
- `topRepRecords` with a position filter returns only that position's sets.
- Position filtered ties resolve through `weightKey`, not raw kg floats.

Verify the card by running the app. Check these flows by hand:

1. Open an exercise with history and no set today. The card reads "Last time".
2. Log one set. The card switches to `SET 2 TOP WEIGHTS`. The switch is smooth and the
   new row's fade in is not stalled.
3. Log more sets. Each swap is a fade with no height change and no stutter.
4. Delete a set. The card steps back one position.
5. Tap a row to edit it. The card does not move.
6. Log past the deepest position in history. The empty state line appears.
7. Open a cardio exercise. The card does not render.
8. Log against a planned set. The count is right before and after the commit.

## Out of scope

- The web client. It has no equivalent card.
- A separate settings toggle for position mode. One `show_last_time` flag covers both.
- Changing what the Summary tab shows.
