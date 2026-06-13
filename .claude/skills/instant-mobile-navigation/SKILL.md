---
name: instant-mobile-navigation
description: Use when a screen, detail page, logger, or date view in the React Native (Expo) mobile app (mobile/) feels slow to open — freezes, hangs, or janks for a moment before the transition starts, taps feel laggy, or navigating to a workout/day/exercise screen stutters before appearing.
---

# Instant Mobile Navigation

## Overview

A screen that "freezes for a second, then opens" is almost never the navigation library. It's the **JS thread blocked by heavy synchronous work before the transition can start** — React Navigation native-stack mounts the destination's React tree *first*, then animates. If first render (or a tab unfreeze) is expensive, the slide can't begin.

**Core principle: make the first paint cheap, defer heavy work past the transition, and open via a lightweight stack push — not into a frozen pre-mounted tab.**

This app keeps the whole dataset in memory; "heavy work" = query functions that materialize/scan the snapshot (`getWorkoutByDateQ`, `getExerciseHistoryQ`, full `workoutFromRow`) plus large subtrees (SVG charts, per-row `Animated.Value`s, `Swipeable`s).

## The levers (in priority order)

### 1. Don't navigate into a pre-mounted tab — push a stack screen
`MainTabs` uses `freezeOnBlur` (see `RootNavigator.tsx`). Navigating to a tab — `navigation.navigate("Main", { screen: "Calendar" })` — **unfreezes every pre-mounted tab on the same JS frame** (DayScreen, ExercisesScreen, etc. all re-run their queries at once). That fan-out *is* the freeze. Instead push a dedicated stack screen that reuses the same component:

```tsx
// SLOW: unfreezes all tabs
navigation.navigate("Main", { screen: "Calendar", params: { date } })
// FAST: keeps tabs frozen, mounts one fresh screen
navigation.navigate("CalendarDate", { date })
```

`CalendarDate` is a stack-registered instance of `CalendarScreen` existing for exactly this reason. Use the stack push for any "open at a target" navigation from a screen that sits above `MainTabs` (ExerciseDetail, SetLogger).

### 2. Defer the destination's heavy work past the animation
Render cheap chrome synchronously; fill heavy content after the transition with `InteractionManager.runAfterInteractions` (it waits until the navigation animation finishes). Gate **both the heavy render and the heavy query** on a `ready` flag — deferring the JSX but still running the materializing query on first render doesn't help.

```tsx
const [ready, setReady] = useState(false)
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => setReady(true))
  return () => task.cancel()
}, [])
// ...
const gym = useMemo(
  () => (ready ? getWorkoutByDateQ(date)?.gym ?? null : null),  // query gated too
  [snapshot, date, ready]
)
return <>{grid}{ready && <DayWorkoutContent date={date} />}</>
```

A pre-mounted tab instance resolves `runAfterInteractions` at app start, so `ready` is already true there — no regression; only fresh stack pushes defer. See `CalendarScreen.tsx`.

### 3. Make the query lazy
Don't compute derived data the default view doesn't need. If a screen defaults to one tab but eagerly runs `getExerciseHistoryQ` for the other tabs, key the `useMemo` on the active tab and return an empty constant until that tab opens.

### 4. Fire the tap immediately
Inside a `ScrollView`, `Pressable` waits ~130ms (press-in/scroll disambiguation) before reacting. Add `unstable_pressDelay={0}` so the press fires instantly — matches the repo's history calendar button (`HistoryDayCard`) and the "+" tab.

### 5. Keep the tap handler synchronous
Never `await` a `localApi` mutation (they're sync, Promise-wrapped) before `navigation.navigate` — awaiting yields to React mid-flow and adds a visible hitch. No snapshot reads/mutations in the handler; defer id resolution like SetLogger defers its create+addExercise to the first Save.

### 6. (Optional) Cheaper, shorter animation
A short or no animation hides a small first-render hitch. The repo uses `animationDuration: 120` on `CalendarDate` and `animation: "none"` on some pops.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| ~1s freeze before the slide starts | Heavy first render blocks the JS thread | Defer with `InteractionManager` (lever 2) |
| Opening a date/day screen freezes | Navigated into a frozen tab → fan-out unfreeze | Push the stack screen instead (lever 1) |
| Deferred the JSX but still slow | The materializing query still ran on mount | Gate the query on `ready` too (lever 2) |
| Tap feels laggy before anything happens | `Pressable` press-in delay in a ScrollView | `unstable_pressDelay={0}` (lever 4) |
| Pop is fast but push is slow | Cost is in mounting the destination, not unmounting | Confirms levers 1–3; not a navigator problem |

## Red flags — stop

- `navigation.navigate("Main", { screen: ... })` to open a target view from a stack screen — prefer the dedicated stack-pushed screen.
- A screen that runs `getWorkoutByDateQ` / `getExerciseHistoryQ` / full materialization unconditionally on first render.
- Deferring a heavy subtree's render but leaving its query ungated.
- `await` between a tap and `navigation.navigate`.
- "It's the navigation library / animation duration" — measure first; a freeze *before* motion is first-render cost.
