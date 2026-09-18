# Set Logger Commit Render Cost Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. See the `using-subagents` skill to decide which tasks are worth delegating.

**Goal:** After a store commit in the mobile set logger, only the parts whose data changed re-render, so the JS thread block after a delete is short enough that a swipe release on another row never waits on it.

**Architecture:** `SetLoggerScreen` subscribes to the whole store snapshot and re-renders its entire tree on every commit. The set list rows are already memoized. This plan makes the remaining children skip: the "Last time" card gets a content-stable `history` array, and the exercise header, the log-set form, and the sub-tab bar move into `memo` components that only receive stable callbacks and scalar props. No animation, layout, or behavior changes. The `Swipeable`, `SwipeHold`, `SetRowFade`, and delete flow stay as they are.

**Tech Stack:** React Native (Expo SDK 57, Fabric), React 19 `memo` / `useCallback`, `@lift/core` store (`useSyncExternalStore`), Vitest for the one pure helper.

**Measurement:** The screen already logs `[swipe-dbg] screen render+commit Nms` (a `useLayoutEffect` timer) and `[swipe-dbg] JS stall Nms` to the Metro terminal in `__DEV__`. Task 1 records the numbers before, Task 6 after. The UI has no automated tests (see `CLAUDE.md`), so each UI task ends with a typecheck and a short on-device checklist.

---

## File map

- Modify: `mobile/src/screens/SetLoggerScreen.tsx`. The parent component, `ExerciseHeader`, `LogSetPanel`, `SubTabBar`, and the `history` wiring all live here. The file is large; this plan adds components next to the existing ones and does not split the file.
- Create: `mobile/src/store/sameHistory.ts`. Pure content compare for `ExerciseHistoryDay[]`.
- Create: `mobile/src/hooks/useStableValue.ts`. Keeps the previous value when a compare says nothing changed.
- Test: `tests/sameHistory.test.ts`. Vitest imports from `mobile/src` by relative path, as `tests/swipeHold.test.ts` does.

Existing pieces the tasks reuse (already in `SetLoggerScreen.tsx`):

- `useStableCallback(fn)`: a handler with fixed identity that calls the latest closure. Defined above `SetRowFade`.
- `LastTimePanel`, `SummaryPanel`: already `memo`. `GraphPanel` is a plain export.
- The `[swipe-dbg]` diagnostics: `dbg()`, the stall monitor, and the render timer near the top of the parent.

---

### Task 1: Record the baseline

**Files:**
- None changed.

- [ ] **Step 1: Start the app and open the set logger**

Run from the repo root: `npm run dev:mobile`. Open Expo Go on the phone. Open an exercise that has at least five logged sets today and turn the "Last time" card on in settings.

- [ ] **Step 2: Delete one set and read the Metro terminal**

Swipe a row, tap Delete. In the terminal, copy every `[swipe-dbg]` line from `delete tap` to the next `store commit`. There are two `screen render+commit` lines: one at the tap (leaving state), one at the commit.

- [ ] **Step 3: Write the numbers into this file**

Fill the "Before" column:

| Moment | Before (ms) | After (ms) |
|---|---|---|
| render+commit at tap | | |
| render+commit at store commit | | |
| largest `JS stall` in the window | | |

No commit for this task.

---

### Task 2: Content-stable `history`

`history` comes from `getExerciseHistoryQ(exerciseId)`, which builds fresh objects on every snapshot. `LastTimePanel` is `memo`, but its `days` prop is a new array on every commit, so it always re-renders, and it is the heaviest child on the workout tab. A delete of a set on today's date does change today's day entry, but the card only reads prior days, so a deep compare that excludes nothing is still correct: the array is only reused when every field is equal.

**Files:**
- Create: `mobile/src/store/sameHistory.ts`
- Create: `mobile/src/hooks/useStableValue.ts`
- Create: `tests/sameHistory.test.ts`
- Modify: `mobile/src/screens/SetLoggerScreen.tsx` (the `history` memo, around line 617)

- [ ] **Step 1: Write the failing test**

Create `tests/sameHistory.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sameHistory } from "../mobile/src/store/sameHistory"
import type { ExerciseHistoryDay, HistorySet } from "@lift/core/types"

function set(id: number, over: Partial<HistorySet> = {}): HistorySet {
  return {
    id,
    weight: 100,
    reps: 5,
    distance_m: null,
    distance_unit_display: "",
    time_seconds: null,
    is_pr: false,
    was_pr: false,
    is_position_pr: false,
    was_position_pr: false,
    note: "",
    order: 0,
    position: 1,
    estimated_one_rm: 116.7,
    ...over,
  }
}

function day(date: string, sets: HistorySet[], note = ""): ExerciseHistoryDay {
  return { date, note, sets }
}

describe("sameHistory", () => {
  it("is true for two arrays with equal content and different identity", () => {
    const a = [day("2026-09-01", [set(1), set(2)])]
    const b = [day("2026-09-01", [set(1), set(2)])]
    expect(a).not.toBe(b)
    expect(sameHistory(a, b)).toBe(true)
  })

  it("is true for the same array", () => {
    const a = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, a)).toBe(true)
  })

  it("is false when a day is added", () => {
    const a = [day("2026-09-01", [set(1)])]
    const b = [day("2026-09-02", [set(3)]), day("2026-09-01", [set(1)])]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is false when a set is removed", () => {
    const a = [day("2026-09-01", [set(1), set(2)])]
    const b = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is false when a set field changes", () => {
    const a = [day("2026-09-01", [set(1)])]
    expect(sameHistory(a, [day("2026-09-01", [set(1, { weight: 102.5 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { reps: 6 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { is_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { was_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { is_position_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { was_position_pr: true })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { note: "x" })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { position: 2 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { estimated_one_rm: 120 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { order: 3 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { time_seconds: 60 })])])).toBe(false)
    expect(sameHistory(a, [day("2026-09-01", [set(1, { distance_m: 1000 })])])).toBe(false)
  })

  it("is false when a day note changes", () => {
    const a = [day("2026-09-01", [set(1)], "easy")]
    const b = [day("2026-09-01", [set(1)], "hard")]
    expect(sameHistory(a, b)).toBe(false)
  })

  it("is true for two empty arrays", () => {
    expect(sameHistory([], [])).toBe(true)
  })
})
```

Check the `HistorySet` field list against `packages/core/src/types/index.ts` (`export interface HistorySet`, line 86). If the interface has a field this test does not set, add it to `set()` with a default.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/sameHistory.test.ts`
Expected: FAIL with `Cannot find module '../mobile/src/store/sameHistory'`.

- [ ] **Step 3: Write the compare**

Create `mobile/src/store/sameHistory.ts`:

```ts
import type { ExerciseHistoryDay, HistorySet } from "@lift/core/types"

// Field compare for two history sets. Lists every field a panel renders,
// so a change in any of them makes the arrays different.
function sameHistorySet(a: HistorySet, b: HistorySet): boolean {
  return (
    a.id === b.id &&
    a.weight === b.weight &&
    a.reps === b.reps &&
    a.distance_m === b.distance_m &&
    a.distance_unit_display === b.distance_unit_display &&
    a.time_seconds === b.time_seconds &&
    a.is_pr === b.is_pr &&
    a.was_pr === b.was_pr &&
    a.is_position_pr === b.is_position_pr &&
    a.was_position_pr === b.was_position_pr &&
    a.note === b.note &&
    a.order === b.order &&
    a.position === b.position &&
    a.estimated_one_rm === b.estimated_one_rm
  )
}

/**
 * True when two history arrays have the same content. getExerciseHistoryQ
 * rebuilds every object on each snapshot, so identity never matches across
 * store commits; this is what lets a memoized panel keep its old props when
 * a commit did not touch this exercise's history.
 */
export function sameHistory(a: ExerciseHistoryDay[], b: ExerciseHistoryDay[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const da = a[i]
    const db = b[i]
    if (da.date !== db.date || da.note !== db.note) return false
    if (da.sets.length !== db.sets.length) return false
    for (let j = 0; j < da.sets.length; j++) {
      if (!sameHistorySet(da.sets[j], db.sets[j])) return false
    }
  }
  return true
}
```

If `HistorySet` has a field not listed here, add it to `sameHistorySet`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/sameHistory.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the hook**

Create `mobile/src/hooks/useStableValue.ts`:

```ts
import { useRef } from "react"

/**
 * Returns the previous value while `same(prev, next)` holds, so a memoized
 * child that receives it sees an unchanged prop. The ref is written during
 * render, which is safe here: the write is idempotent for a given input.
 */
export function useStableValue<T>(next: T, same: (a: T, b: T) => boolean): T {
  const ref = useRef(next)
  if (ref.current !== next && !same(ref.current, next)) ref.current = next
  return ref.current
}
```

- [ ] **Step 6: Wire it into the screen**

In `mobile/src/screens/SetLoggerScreen.tsx`, add the imports next to the other local imports (around line 72, after `import { NotePreview } from "../components/NotePreview"`):

```ts
import { sameHistory } from "../store/sameHistory"
import { useStableValue } from "../hooks/useStableValue"
```

Find the `history` memo (search for `const history: ExerciseHistoryDay[] = useMemo(`). Replace:

```ts
  const history: ExerciseHistoryDay[] = useMemo(() => {
    if (exerciseId == null || !needsHistory) return EMPTY_HISTORY
    return getExerciseHistoryQ(exerciseId)
  }, [snapshot, exerciseId, needsHistory])
```

with:

```ts
  const rawHistory: ExerciseHistoryDay[] = useMemo(() => {
    if (exerciseId == null || !needsHistory) return EMPTY_HISTORY
    return getExerciseHistoryQ(exerciseId)
  }, [snapshot, exerciseId, needsHistory])
  // Identity-stable while the content is unchanged, so LastTimePanel,
  // GraphPanel, and SummaryPanel skip their render on commits that did not
  // touch this exercise's history (a set edit elsewhere, a note, a sync).
  const history = useStableValue(rawHistory, sameHistory)
```

- [ ] **Step 7: Typecheck and run the suite**

Run: `cd mobile && npm run typecheck`
Expected: no output, exit 0.

Run from the root: `npm test`
Expected: all files pass, the count is 7 higher than before.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/store/sameHistory.ts mobile/src/hooks/useStableValue.ts tests/sameHistory.test.ts mobile/src/screens/SetLoggerScreen.tsx
git commit -m "perf(mobile): keep exercise history identity-stable across commits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `ExerciseHeader` as a memo component

The header (exercise name, category, and the optional note row) is inline in the parent and re-renders with it. Its inputs are three strings and one handler.

**Files:**
- Modify: `mobile/src/screens/SetLoggerScreen.tsx` (the `titleWrap` block, around lines 1431 to 1460, and a new component above `SetRowFade`)

- [ ] **Step 1: Add the component**

Insert directly above `function SetRowFade({` (and below `useStableCallback`):

```tsx
// Exercise name, category, and the optional note row. Memoized: the parent
// re-renders on every store commit and keystroke, and this block's inputs
// only change when the user renames or annotates the exercise.
const ExerciseHeader = memo(function ExerciseHeader({
  name,
  category,
  note,
  onOpenNote,
}: {
  name: string
  category: string
  note: string
  onOpenNote: () => void
}) {
  return (
    <View style={styles.titleWrap}>
      <Text style={styles.exerciseName}>{name}</Text>
      <Text style={styles.exerciseMeta}>{category}</Text>
      {/* Only when there is something to read. Writing the first one is
          the header menu's job: a standing "Add a note" prompt under
          every exercise name was more chrome than the screen carried. */}
      {!!note.trim() && (
        <Pressable onPress={onOpenNote} hitSlop={8} style={styles.exNoteRow}>
          <Ionicons
            name="document-text-outline"
            size={12}
            color={theme.colors.muted}
          />
          {/* The wrapper takes the row's remaining width. exNoteText must
              NOT: it is applied per line inside NotePreview's column,
              where flex:1 makes every line stretch instead of stacking. */}
          <View style={styles.exNoteBody}>
            <NotePreview note={note} style={styles.exNoteText} />
          </View>
        </Pressable>
      )}
    </View>
  )
})
```

- [ ] **Step 2: Give the parent a stable handler**

`openExerciseNote` is a function declaration in the parent (search `function openExerciseNote()`). Directly after the existing block of stable row callbacks (search `const onRowDelete = useStableCallback(`), add:

```ts
  const onOpenExerciseNote = useStableCallback(openExerciseNote)
```

- [ ] **Step 3: Replace the inline block**

In the parent's JSX, replace the whole `<View style={styles.titleWrap}> ... </View>` block (it starts right after `<Pressable style={styles.fixedTop} onPress={() => Keyboard.dismiss()}>` and ends before `{tab === "workout" && !firstPaintDone && (`) with:

```tsx
        <ExerciseHeader
          name={we.exercise.name}
          category={we.exercise.category}
          note={we.note}
          onOpenNote={onOpenExerciseNote}
        />
```

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: exit 0. If `NotePreview`, `Ionicons`, `theme`, or `styles` are reported as not found, the component was placed above their import or definition; it must sit below the imports and above `SetRowFade`.

- [ ] **Step 5: On-device check**

Open an exercise with a note: the note row shows and opens the note sheet on tap. Open one without: no note row. Edit the note from the header menu: the row updates.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/SetLoggerScreen.tsx
git commit -m "perf(mobile): memoize the set logger exercise header

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `LogSetPanel` as a memo component

The log-set form and the selection bar (the swap block) are inline in the parent. On a store commit none of their inputs change, but the block still reconciles two `Animated.View` layers, three `NumericField`s, two `PhaseButton`s, and their interpolations. The component takes the parent's `Animated.Value`s (stable refs), the form state as scalars, and stable callbacks.

**Files:**
- Modify: `mobile/src/screens/SetLoggerScreen.tsx` (the block from `{tab === "workout" && firstPaintDone && (` inside the fixed top `Pressable`, around lines 1473 to 1629; a new component above `SetRowFade`; stable callbacks in the parent)

- [ ] **Step 1: Add the component**

Insert directly above `function SetRowFade({` (below `ExerciseHeader` from Task 3):

```tsx
// The form <-> selection-bar swap. Memoized: on a store commit nothing here
// changes, and reconciling two animated layers, three NumericFields, and
// two PhaseButtons was a large share of the post-commit render. Every
// Animated value is a ref the parent owns; every handler is identity-stable.
const LogSetPanel = memo(function LogSetPanel({
  swapAnim,
  swapHeight,
  editAnim,
  restReveal,
  restShown,
  fieldHeight,
  selectionMode,
  selectedCount,
  isCardio,
  unit,
  step,
  weight,
  reps,
  restSec,
  editing,
  showRestTime,
  error,
  onBarLayout,
  onFormLayout,
  onFieldLayout,
  onChangeWeight,
  onChangeReps,
  onChangeRest,
  onSave,
  onClearOrCancel,
  onClearSelection,
  onDeleteSelected,
}: {
  swapAnim: Animated.Value
  swapHeight: Animated.AnimatedInterpolation<number> | null
  editAnim: Animated.Value
  restReveal: Animated.Value
  restShown: boolean
  fieldHeight: number
  selectionMode: boolean
  selectedCount: number
  isCardio: boolean
  unit: "kg" | "lb"
  step: number
  weight: number
  reps: number
  restSec: number
  editing: boolean
  showRestTime: boolean
  error: string | null
  onBarLayout: (e: LayoutChangeEvent) => void
  onFormLayout: (e: LayoutChangeEvent) => void
  onFieldLayout: (e: LayoutChangeEvent) => void
  onChangeWeight: (v: number) => void
  onChangeReps: (v: number) => void
  onChangeRest: (v: number) => void
  onSave: () => void
  onClearOrCancel: () => void
  onClearSelection: () => void
  onDeleteSelected: () => void
}) {
  // The form side of this wrapper's height comes from the form's own
  // measured height (see onFormLayout in the parent), not a constant, so
  // entering edit mode grows the card instead of clipping its buttons. Both
  // layers stay mounted the whole time, absolutely positioned on top of each
  // other, and cross-fade via swapAnim: only their opacity and this
  // wrapper's height ever change, so nothing below this card re-lays out.
  return (
    <Animated.View
      style={[
        { overflow: "hidden" },
        swapHeight != null && { height: swapHeight },
      ]}
    >
      <Animated.View
        onLayout={onBarLayout}
        pointerEvents={selectionMode ? "auto" : "none"}
        style={[
          styles.card,
          styles.selectionBar,
          styles.swapLayer,
          { opacity: swapAnim, zIndex: selectionMode ? 2 : 1 },
        ]}
      >
        <Pressable
          onPress={onClearSelection}
          hitSlop={12}
          style={styles.selectionCancelBtn}
        >
          <Ionicons name="close" size={22} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.selectionCount}>{selectedCount} selected</Text>
        <Pressable
          onPress={onDeleteSelected}
          style={({ pressed }) => [
            styles.selectionDeleteBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={theme.colors.destructive}
          />
          <Text style={styles.selectionDeleteText}>Delete</Text>
        </Pressable>
      </Animated.View>

      <Animated.View
        onLayout={onFormLayout}
        pointerEvents={selectionMode ? "none" : "auto"}
        style={[
          styles.card,
          {
            opacity: swapAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
            zIndex: selectionMode ? 1 : 2,
          },
        ]}
      >
        {/* Absolute overlay that fades a white border in/out. Using
         *  opacity (native-supported) keeps everything on the native
         *  driver, avoiding the JS/native mixing error. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.cardEditBorder, { opacity: editAnim }]}
        />
        <NumericField
          label={
            isCardio
              ? editing ? "Time (editing)" : "Time"
              : editing ? "Weight (editing)" : "Weight"
          }
          unit={isCardio ? "min" : unit}
          value={weight}
          step={isCardio ? 1 : step}
          min={0}
          onChange={onChangeWeight}
          allowDecimal
        />
        <View onLayout={onFieldLayout}>
          <NumericField
            label={isCardio ? "Level" : "Reps"}
            value={reps}
            step={1}
            min={0}
            onChange={onChangeReps}
          />
        </View>
        {showRestTime && (
          // Stays mounted and collapses to height 0 rather than
          // unmounting, so entering and leaving edit mode animates. The
          // negative margin cancels the card's `gap` while the row is
          // collapsed, so a hidden row adds nothing to the card.
          // fieldHeight comes from the Reps field (see the parent).
          <Animated.View
            pointerEvents={restShown ? "auto" : "none"}
            style={{
              overflow: "hidden",
              opacity: restReveal,
              height: restReveal.interpolate({
                inputRange: [0, 1],
                outputRange: [0, fieldHeight || FIELD_H_FALLBACK],
              }),
              marginTop: restReveal.interpolate({
                inputRange: [0, 1],
                outputRange: [-CARD_GAP, 0],
              }),
            }}
          >
            <NumericField
              label="Rest (sec)"
              value={restSec}
              step={5}
              min={0}
              onChange={onChangeRest}
            />
          </Animated.View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <PhaseButton
            defaultLabel="Save"
            altLabel="Update"
            phase={editAnim}
            onPress={onSave}
            style={{ flex: 1 }}
          />
          <PhaseButton
            defaultLabel="Clear"
            altLabel="Cancel"
            phase={editAnim}
            variant="secondary"
            onPress={onClearOrCancel}
            style={{ flex: 1 }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  )
})
```

The `swapAnim.interpolate` and the two `restReveal.interpolate` calls create new interpolation nodes on each render of this component, exactly as the inline version did on each parent render. This component now renders only when one of its props changes, so that is strictly fewer nodes than before.

- [ ] **Step 2: Give the parent stable handlers**

Directly after `const onOpenExerciseNote = useStableCallback(openExerciseNote)` (Task 3), add:

```ts
  // LogSetPanel is memoized; these keep its callback props identity-stable.
  const onSave = useStableCallback(save)
  const onClearOrCancel = useStableCallback(() => {
    if (editingSetId != null) {
      cancelEdit()
    } else {
      setWeight(0)
      setReps(0)
      setError(null)
    }
  })
  const onClearSelection = useStableCallback(clearSelection)
  const onDeleteSelected = useStableCallback(confirmDeleteSelected)
  const onBarLayout = useStableCallback((e: LayoutChangeEvent) =>
    setBarHeight(e.nativeEvent.layout.height)
  )
  const onFormLayoutStable = useStableCallback(onFormLayout)
  const onFieldLayoutStable = useStableCallback(onFieldLayout)
```

`save`, `cancelEdit`, `clearSelection`, `confirmDeleteSelected`, `onFormLayout`, and `onFieldLayout` are function declarations in the parent, so they are hoisted and can be referenced here regardless of where they sit. `setWeight`, `setReps`, `setRestSec`, `setError`, and `setBarHeight` are `useState` setters and already stable.

- [ ] **Step 3: Replace the inline block**

In the parent's JSX, replace everything from `{tab === "workout" && firstPaintDone && (` (the one inside the fixed top `Pressable`, directly after the `!firstPaintDone` placeholder block) through the matching `)}` that closes it, just before `</Pressable>`, with:

```tsx
        {tab === "workout" && firstPaintDone && (
          <LogSetPanel
            swapAnim={swapAnim}
            swapHeight={swapHeight}
            editAnim={editAnim}
            restReveal={restReveal}
            restShown={restShown}
            fieldHeight={fieldHeight}
            selectionMode={selectionMode}
            selectedCount={selectedIds.length}
            isCardio={isCardio}
            unit={unit}
            step={step}
            weight={weight}
            reps={reps}
            restSec={restSec}
            editing={editingSetId != null}
            showRestTime={showRestTime}
            error={error}
            onBarLayout={onBarLayout}
            onFormLayout={onFormLayoutStable}
            onFieldLayout={onFieldLayoutStable}
            onChangeWeight={setWeight}
            onChangeReps={setReps}
            onChangeRest={setRestSec}
            onSave={onSave}
            onClearOrCancel={onClearOrCancel}
            onClearSelection={onClearSelection}
            onDeleteSelected={onDeleteSelected}
          />
        )}
```

Delete the long comment that sat above the old `<Animated.View` (the one that starts "The form <-> selection-bar swap: this wrapper's height animates"); its content now lives in `LogSetPanel`.

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: exit 0. If `swapHeight`'s type does not match `Animated.AnimatedInterpolation<number> | null`, read the `swapHeight` memo in the parent (search `const swapHeight = useMemo(`) and set the prop type to what it returns.

- [ ] **Step 5: On-device check**

All of these must behave as before:

1. Type a weight and reps, tap Save: the row appears, the form keeps its values.
2. Tap Clear: weight and reps go to 0.
3. Swipe a row, tap Edit: the form grows, labels say "(editing)", buttons read Update / Cancel, the rest field unfolds when rest time is on. Tap Cancel: the form shrinks back.
4. Long-press a row: the selection bar cross-fades in and the list slides up to meet it. Tap X: the form comes back. Select two, tap Delete, confirm: both rows go.
5. Enter a negative weight and Save: the error text shows under the fields.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/SetLoggerScreen.tsx
git commit -m "perf(mobile): memoize the set logger form and selection bar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `SubTabBar` as a memo component

Small, but it mounts five `Pressable`s with icons and re-renders on every parent render. `setTab` is a state setter, so it is already stable.

**Files:**
- Modify: `mobile/src/screens/SetLoggerScreen.tsx` (`function SubTabBar(`, around line 1906)

- [ ] **Step 1: Wrap it**

Replace:

```tsx
function SubTabBar({ tab, onChange }: { tab: SubTab; onChange: (t: SubTab) => void }) {
```

with:

```tsx
// Memoized: its only inputs are the active tab and the (stable) setter.
const SubTabBar = memo(function SubTabBar({ tab, onChange }: { tab: SubTab; onChange: (t: SubTab) => void }) {
```

Find the closing `}` of that function (the next line that is exactly `}` at column 0 after the function's `return (` block) and change it to:

```tsx
})
```

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: On-device check**

Switch between Workout, History, Graph, Summary, Settings: the active tab highlights and the content changes.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/SetLoggerScreen.tsx
git commit -m "perf(mobile): memoize the set logger sub-tab bar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Measure again, confirm the swipe, remove the diagnostics

**Files:**
- Modify: `mobile/src/screens/SetLoggerScreen.tsx` (every line that references `dbg`, `SWIPE_DBG`, `dbgT0`, `dbgRenderStart`, and the stall monitor effect)
- Modify: `docs/plans/2026-09-18-set-logger-commit-render-cost.md` (the table)

- [ ] **Step 1: Repeat Task 1 and fill the "After" column**

Same exercise, same steps. Copy the `screen render+commit` and `JS stall` values into the table in this file.

- [ ] **Step 2: Confirm the swipe on device**

Swipe a row, tap Delete, then at once swipe another row and release mid-drag. Repeat five times. Note in this file whether any release paused, and for how long the `JS stall` line said.

If the "After" render+commit is still over about 50 ms in Expo Go, stop here and report the numbers before removing the diagnostics: the next candidate is the parent's own `useStore((s) => s.snapshot)` subscription, and that is a separate plan.

- [ ] **Step 3: Remove the diagnostics**

In `SetLoggerScreen.tsx`, delete:

1. The block that starts with `// TEMPORARY swipe-freeze diagnostics. Remove after the investigation.` through the closing `}` of `function dbg(`.
2. In the parent, the block that starts with `// TEMPORARY: JS thread stall monitor and per-render timer.` through the closing `}, [])` of the stall monitor effect (two hooks: the `useLayoutEffect` render timer and the `useEffect` monitor).
3. Every remaining `dbg(` call: search for `dbg(` and delete each line. They are in `startDeleteMany` (`delete tap`), the delete completion (`commit held` and `store commit`, plus the `const c0 = Date.now()` line the latter uses), `SetRowFade` (`row collapse start`, `row collapse done`), and the three `Swipeable` callbacks in `SetRow` (`drag start`, `release (open)`, `release (close)`).

Then check `useLayoutEffect` is still used elsewhere in the file (search for it). If it is not, remove it from the `react` import at the top.

- [ ] **Step 4: Typecheck and run the suite**

Run: `cd mobile && npm run typecheck`
Expected: exit 0.

Run from the root: `npm test`
Expected: all pass.

Run: `grep -n "swipe-dbg\|dbg(" mobile/src/screens/SetLoggerScreen.tsx`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/SetLoggerScreen.tsx docs/plans/2026-09-18-set-logger-commit-render-cost.md
git commit -m "chore(mobile): drop the set logger swipe diagnostics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Out of scope

- Moving `useStore((s) => s.snapshot)` out of the parent. The parent must re-render when the workout changes; after this plan its own render is small. If Task 6 shows it is still too slow, plan that separately.
- `TimeSinceLastSet` ticks its own state ten times per second. It is a leaf and its render is one `Text`; it is not part of the delete block.
- Any change to `SetRowFade`, `SetListEmptyTransition`, `LastTimePanel`'s height animation, the `Swipeable` settings, or `SwipeHold`.
