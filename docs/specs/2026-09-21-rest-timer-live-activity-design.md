# Rest timer on the Lock Screen and Dynamic Island

Date: 2026-09-21. Status: approved design, not yet implemented.

## Summary

After the user saves a set in the mobile app, the phone shows a count-up rest timer outside the app. On an iPhone with a Dynamic Island (iPhone 14 Pro and later) it shows next to the camera cutout. On other iPhones it shows on the Lock Screen and in Notification Center. On Android it is an ongoing notification with a live chronometer. The timer restarts on every saved set and disappears at a cutoff (default 6:00, user-set, maximum 15:00). A setting turns the feature on and off. It is on by default.

The in-app "time since last set" ticker is unchanged. This feature only mirrors it outside the app.

## Requirements

- Count up only. No rest goal, no alert.
- Starts when the user saves a set (a normal log or a planned set that is logged). Not on an edit.
- Restarts on the next saved set. Only one timer exists at a time.
- Keeps running when the user leaves the set logger screen. Ends only at the next set, at the cutoff, or when the user turns the feature off.
- Cutoff: free minutes and seconds field, range 0:30 to 15:00, default 6:00.
- Content: compact Dynamic Island shows time only. Expanded island and Lock Screen show exercise name and time.
- Setting is on by default. Android asks for notification permission the first time a set is saved with the feature on.
- Settings are synced (`Snapshot.settings`). The web app ignores them.
- Works with an unsigned CI build that is signed later by AltServer.

Out of scope: a rest goal or countdown, alerts, opening a specific screen on tap (a tap opens the app), ending the timer when the anchor set is deleted, the web app.

## Architecture

### 1. Core settings (`packages/core`)

Add two optional keys to `UserSettings` in `packages/core/src/types/index.ts`:

```ts
rest_timer_activity?: boolean   // default true
rest_timer_cutoff_s?: number    // default 360, valid 30..900
```

Optional keys with `?? default` reads follow the existing pattern (`show_time_since_last_set`). No `SCHEMA_VERSION` bump. `updateSettings` already handles arbitrary keys. `tests/` gets a case that the defaults resolve as above.

### 2. Native module `mobile/modules/rest-timer/`

Same shape as `mobile/modules/backup-folder`, with both platforms in `expo-module.config.json`. Package name `rest-timer`, linked from `mobile/package.json` as `"rest-timer": "file:./modules/rest-timer"`. Autolinked; no config plugin entry for the module itself.

JS surface (`index.ts`), all functions return promises:

```ts
start(input: { exerciseName: string; startedAt: number; endsAt: number }): Promise<void>
update(input: same): Promise<void>   // no-op and resolves if nothing is running
end(): Promise<void>
isRunning(): Promise<boolean>
```

`startedAt` and `endsAt` are epoch milliseconds. The module exports `null` in Expo Go (`requireOptionalNativeModule`).

**iOS (`ios/RestTimerModule.swift`)**

- Guards everything with `if #available(iOS 16.2, *)`; older iOS resolves without doing anything. The app deployment target stays 15.1.
- Holds `Activity<RestTimerAttributes>?`. On the first call it recovers an existing activity from `Activity<RestTimerAttributes>.activities` so the app can end an activity from a previous process.
- `start`: ends any running activity, then `Activity.request(attributes:, content: ActivityContent(state:, staleDate: endsAt))`.
- `update`: `activity.update(ActivityContent(state:, staleDate: endsAt))`.
- `end`: `activity.end(nil, dismissalPolicy: .immediate)`.
- Keeps one `DispatchSourceTimer` armed for `endsAt`. While the process is alive (foreground, or the short background grace period) it ends the activity at the cutoff.
- If the process is suspended before the cutoff, iOS cannot run our code. The SwiftUI timer is range-bound (`startedAt...endsAt`) so it stops at the cutoff on its own, and `staleDate` makes `context.isStale` true so the view dims. The app ends it on the next return to foreground (see controller). This is a known limit and accepted.
- `RestTimerAttributes` is defined in `ios/RestTimerAttributes.swift` inside the module **and** copied byte-for-byte into the widget target. ActivityKit matches the activity by the type name and its JSON-encoded state, so the two copies must stay identical. A comment at the top of each file says so.

```swift
struct RestTimerAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var exerciseName: String
    var startedAt: Date
    var endsAt: Date
  }
}
```

**Android (`android/src/main/java/expo/modules/resttimer/RestTimerModule.kt`)**

- One notification channel `rest_timer`, `IMPORTANCE_LOW` (silent, and not `MIN`, which Android 16 Live Updates reject).
- One fixed notification id.
- `start` and `update` both post the same notification (posting again with the same id replaces it):
  `setContentTitle(exerciseName)`, `setWhen(startedAt)`, `setUsesChronometer(true)`, `setShowWhen(true)`, `setOngoing(true)`, `setOnlyAlertOnce(true)`, `setSilent(true)`, `setTimeoutAfter(endsAt - now)`, `setContentIntent(launch intent for the app)`, `setSmallIcon(R.drawable.ic_rest_timer)` (a monochrome vector in the module's `res/drawable`), `setCategory(CATEGORY_STOPWATCH)`, `setRequestPromotedOngoing(true)`.
- `setTimeoutAfter` makes Android remove the notification at the cutoff with no app process. No timer is needed on Android.
- `setRequestPromotedOngoing` needs `androidx.core:core:1.17.0` or later. The module's `build.gradle` declares it. On Android 16 with the `POST_PROMOTED_NOTIFICATIONS` permission the timer also pins to the status bar chip; on older Android it is a normal ongoing notification. No `setShortCriticalText`, so the chip shows the chronometer.
- `end`: `NotificationManager.cancel(id)`.
- Permissions: `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS` go into `app.json` `android.permissions`. The runtime request for `POST_NOTIFICATIONS` (Android 13 and later) is done in JS with React Native's `PermissionsAndroid`; the module does not ask.

### 3. Widget extension `mobile/targets/rest-timer/`

`@bacons/apple-targets` is added to `mobile/package.json` and to `app.json` `plugins`. It turns this folder into a widget extension target on every `expo prebuild --clean`, which is what CI runs.

Files:

- `expo-target.config.js`: `{ type: "widget", name: "RestTimer", deploymentTarget: "16.2", frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"] }`. No entitlements, no App Group: the app starts the activity and the extension only draws it.
- `RestTimerAttributes.swift`: the copy described above.
- `RestTimerLiveActivity.swift`: `ActivityConfiguration(for: RestTimerAttributes.self)` with these views. The time is always `Text(timerInterval: state.startedAt...state.endsAt, countsDown: false)` with `.monospacedDigit()`, which iOS renders and ticks by itself.
  - Lock Screen and Notification Center banner: exercise name on the left, time on the right, on a dark background that matches the app (`#0a0a0a`).
  - Dynamic Island compact: leading shows an SF Symbol `timer`; trailing shows the time. Nothing else.
  - Dynamic Island minimal (when two activities share the island): the time.
  - Dynamic Island expanded: exercise name in the leading region, time in the trailing region.
  - When `context.isStale` is true (past the cutoff, app suspended) the views draw at 50% opacity.
- `RestTimerBundle.swift`: the `@main WidgetBundle` that registers the Live Activity.

`app.json` also gets `ios.infoPlist.NSSupportsLiveActivities: true`. Without it iOS refuses to start an activity.

`ios.appleTeamId` stays unset. CI builds with `CODE_SIGNING_ALLOWED=NO`, which covers both targets. AltServer signs the app and the nested `PlugIns/RestTimer.appex` and gives the extension its own App ID. The first implementation step verifies this in a CI build before any UI work.

### 4. JS controller `mobile/src/restTimer/`

The only code that calls the module. Files:

- `plan.ts`: pure functions, no native or store access, unit-tested from `tests/`.
  - `parseCutoff(text): number | null` accepts `"6"`, `"6:30"`, `"06:30"`, `"0:45"`; returns seconds or null when invalid.
  - `clampCutoff(s)`: 30..900.
  - `formatCutoff(s)`: `"6:30"`.
  - `decide(running: { endsAt } | null, now, settings)`: returns `"start"`, `"update"`, `"end"`, or `"none"`. Rules: feature off and something running, `"end"`; feature off, `"none"`; something running and `now < endsAt`, `"update"`; else `"start"`.
- `controller.ts`:
  - `setLogged(exerciseName: string, atMs: number)`: reads settings from the store, computes `endsAt = atMs + cutoff * 1000`, asks Android for permission on first use (once per process; denied means skip silently), calls `start` or `update` per `decide`. Fire-and-forget: it never blocks the caller and swallows errors to `console.warn`. It keeps `endsAt` in module state so `decide` does not need a native round trip.
  - `reconcile()`: if the local state says something may be running and `now >= endsAt`, or `isRunning()` says one exists from a previous process and the local state is empty, call `end()`. Called on every return to foreground.
  - `disable()`: `end()`. Called when the user turns the setting off.
- `bridge.ts`: wraps the module, returns early when it is null (Expo Go), mirrors `mobile/src/backup/folderBridge.ts`.

### 5. Hooks into existing code

- `mobile/src/screens/SetLoggerScreen.tsx` `save()`: at the two points where it sets `pendingAdd` (normal log, and logging a planned set) call `restTimer.setLogged(exerciseName, key)` with the same `Date.now()` value used for `pendingAdd.key`, so the in-app ticker and the Live Activity agree. Not on the edit branch. The call goes before any deferred work and does not `await`.
- `mobile/src/store/bootstrap.ts`: in the existing `AppState` listener, on `"active"` call `restTimer.reconcile()` after `scheduleAutoSync()`.
- `mobile/src/screens/SettingsScreen.tsx`, next to the existing "Time since last set" toggle:
  - `OnOffSetting` "Rest timer outside the app". Subtitle on iOS: "Lock Screen and Dynamic Island". On Android: "Notification". Turning it off calls `restTimer.disable()`. Turning it on, on Android, requests `POST_NOTIFICATIONS`.
  - A "Hide timer after" row with a `TextInput` (keyboard `numbers-and-punctuation`), placeholder `6:00`. The value commits on blur and on submit through `parseCutoff` and `clampCutoff`; an invalid entry reverts to the stored value. Shows `formatCutoff` of the stored value. A change applies to the next saved set, not to a running timer.

## Data flow

1. User taps Save in the set logger. `save()` sets `pendingAdd` with `key = Date.now()` and calls `restTimer.setLogged(name, key)`.
2. Controller reads `rest_timer_activity` and `rest_timer_cutoff_s`, runs `decide`, calls the bridge.
3. iOS: module requests or updates the activity. The extension draws it and ticks the timer by itself. Android: module posts the notification with a chronometer.
4. At the cutoff: iOS module timer ends the activity if the process is alive; otherwise the view freezes and dims until `reconcile()` on the next foreground. Android removes the notification by itself.
5. Next set: step 1 again. `decide` returns `"update"` while the previous timer is inside its cutoff, so the island does not re-animate.

## Error handling

- Every native call is wrapped; failures go to `console.warn` and never reach the set-logger flow. Saving a set must never fail or slow down because of the timer.
- Module null (Expo Go, or web): controller returns immediately.
- iOS below 16.2: module resolves without action.
- Android permission denied: controller remembers this for the process and stops asking. The Settings toggle stays on; the user can grant permission later in system settings.
- ActivityKit can refuse to start (user disabled Live Activities for the app in system settings, or the 8-hour limit). The module rejects; the controller warns and clears its local state.

## Testing

- Vitest (`tests/restTimerPlan.test.ts`): `parseCutoff`, `clampCutoff`, `formatCutoff`, `decide`, imported from `mobile/src/restTimer/plan.ts` like the existing `monthPaging` suite. `tests/` settings case for the two defaults.
- Type checks: `cd mobile && npm run typecheck`, `npm test` at root.
- iOS compile check on this Mac: `npx expo prebuild --platform ios --clean` then `xcodebuild` with the same unsigned flags as CI. This catches Swift errors before a 20-minute CI run.
- Android compile check: CI only (`npm run apk:gh`). There is no Android SDK on this Mac.
- Device test by the user, per the project rule (no simulator): iPhone 16 Pro for the island, iPhone 13 for the Lock Screen. Checklist: timer appears after Save; restarts on the next set; survives leaving the logger; disappears at the cutoff; the toggle ends it; the cutoff field rejects `20:00` and accepts `6:30`; AltStore keeps the extension.

## Open risks

- `@bacons/apple-targets` without `appleTeamId` on an unsigned CI build: expected to work; verified in step 1 of the plan. If it fails, the fallback is to set a placeholder team id in `app.json` (CI ignores signing anyway).
- AltStore counts the extension as one more App ID (10 per week on a free Apple ID). Acceptable for one app.
- iOS past-cutoff freeze while suspended, described above.
