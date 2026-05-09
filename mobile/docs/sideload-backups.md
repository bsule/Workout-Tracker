# Sideload-safe automatic backups

## Why this exists

The app stores everything in its iOS sandbox via [mobile/src/store/storage.ts](../src/store/storage.ts) (`FileSystem.documentDirectory + "lift/"`). Deleting the app wipes that directory.

For users on the App Store / TestFlight this is mostly fine — iCloud device backup catches it. But the realistic distribution path early on is **sideloading** (AltStore, Sideloadly, free Apple Developer accounts). Sideloaded apps end up reinstalled often: 7-day cert expiry, AltServer not running for >7 days, switching tools, system update bugs. Every reinstall = full data loss.

This doc covers the two-piece fix that does **not** require a backend, a paid Apple Developer account, or iCloud entitlements:

1. **Auto-export** a snapshot to a user-picked folder in Files / iCloud Drive after every meaningful write.
2. **Auto-restore** from that folder when the app launches with an empty store (i.e. fresh reinstall).

The folder lives outside the app sandbox, so the data survives `delete app → reinstall`.

## Constraints to respect

- Free Apple Developer accounts cannot use iCloud entitlements, push, or associated domains. The folder must be a Files/iCloud Drive location the user picks themselves — not a ubiquity container.
- iOS does not let apps write to arbitrary file paths across launches without permission. Each user-picked URL must be persisted as a **security-scoped bookmark**; the app re-resolves it on every write.
- Background scheduling is unreliable on iOS and impossible if the app has been force-quit or deleted. Backups must be triggered on **app open + after writes**, not on a wall-clock schedule.
- Expo / React Native does not expose security-scoped bookmarks. A small native module is required.

## High-level design

```
First launch (or "Set up backups" tap)
  └─ user picks folder via UIDocumentPicker (export mode)
     └─ store security-scoped bookmark in app store

App open / after every workout save (debounced)
  └─ resolve bookmark → write snapshot.json into folder
     └─ if write fails (folder gone, iCloud offline), surface a banner

App open with empty store
  └─ if bookmark exists: read snapshot.json, offer "Restore from backup"
  └─ if no bookmark: offer "Pick backup folder to restore from"
```

## Pieces to build

### 1. Native module: `BackupFolderBridge`

Tiny Swift module exposing three methods to JS. Lives at `mobile/modules/backup-folder/` (Expo modules) or as a bare React Native native module — pick whichever matches the existing setup.

```swift
// pickFolder() -> { bookmark: base64String } | null
//   Presents UIDocumentPickerViewController(forOpeningContentTypes: [.folder]).
//   On pick: startAccessingSecurityScopedResource, then
//     URL.bookmarkData(options: .withSecurityScope, ...)
//   Returns base64 of bookmark data.

// writeFile(bookmarkBase64, filename, utf8Contents) -> { ok: true } | { error }
//   Resolve bookmark with .withSecurityScope, isStale handling.
//   startAccessingSecurityScopedResource on the resolved URL.
//   Write atomically: write to a temp file in the same folder, then replace.
//   stopAccessingSecurityScopedResource in defer.

// readFile(bookmarkBase64, filename) -> { contents: string } | { error: "not-found" | other }
//   Same resolution + access scoping. Used by the restore flow.
```

Notes:

- Always handle `isStale = true` by re-creating the bookmark from the resolved URL and returning the new bookmark data so JS can persist it.
- For iCloud Drive folders, call `FileManager.default.startDownloadingUbiquitousItem(at:)` before reading if `NSFileVersion.unresolvedConflictVersionsOfItem(at:)` indicates the file isn't local yet. Reading will block briefly while iCloud downloads.
- Wrap all FS work in a background queue; bridge results back to JS.

### 2. JS wrapper

`mobile/src/backup/folderBridge.ts` — thin TS interface over the native module.

```ts
export type FolderBookmark = string // opaque base64

export const folderBridge = {
  pickFolder(): Promise<FolderBookmark | null>,
  writeFile(b: FolderBookmark, name: string, contents: string):
    Promise<{ bookmark?: FolderBookmark }>, // returns refreshed bookmark if iOS rotated it
  readFile(b: FolderBookmark, name: string):
    Promise<{ contents: string } | { error: "not-found" | "denied" | "other" }>,
}
```

### 3. Backup state in the store

Extend the existing settings/preferences slice with:

```ts
type BackupSettings = {
  bookmark: string | null         // security-scoped bookmark, base64
  folderLabel: string | null      // display name for UI ("iCloud Drive › Lift Backups")
  lastBackupAt: string | null     // ISO timestamp
  lastBackupError: string | null  // surfaced in UI if non-null
}
```

Persist alongside the existing snapshot in [mobile/src/store/storage.ts](../src/store/storage.ts). The bookmark is small and not sensitive in the prompt-injection sense, but it does grant access to a user folder — keep it out of exports / logs.

### 4. Backup runner

`mobile/src/backup/runner.ts` — pure orchestration, no UI.

```ts
// Called from:
//   - App open (after store hydration)
//   - After workout save / set save / settings change (debounced 5s)
//   - Manual "Back up now" button

async function runBackup(reason: "open" | "write" | "manual"): Promise<BackupOutcome>
```

Logic:

1. If no bookmark, no-op (return `"not-configured"`).
2. Build snapshot JSON via existing `buildJson(snapshot, username)` from `@lift/core/export`.
3. Filename: `lift-backup.json` (overwrite — single file, atomic). Optionally also write `lift-backup-YYYY-MM-DD.json` once per day for history.
4. Call `folderBridge.writeFile(bookmark, filename, contents)`.
5. On success: set `lastBackupAt`, clear `lastBackupError`, persist refreshed bookmark if returned.
6. On failure: set `lastBackupError`. Don't retry in a loop — wait for the next trigger.

Use the existing write queue pattern from `RnFsStorage.enqueue` so concurrent writes serialize.

### 5. App-open hook

In the navigation root (or wherever store hydration completes — see [mobile/src/navigation/RootNavigator.tsx](../src/navigation/RootNavigator.tsx)):

```ts
useEffect(() => {
  if (!hydrated) return
  if (storeIsEmpty(snapshot)) {
    // Restore flow — see step 6
    promptRestore()
  } else {
    // Best-effort backup; don't block UI
    void runBackup("open")
  }
}, [hydrated])
```

Also subscribe to AppState `active` transitions to trigger an opportunistic backup when the user foregrounds the app after a long absence.

### 6. Restore flow

New screen: `mobile/src/screens/RestoreBackupScreen.tsx` — only shown when launching with an empty store.

```
Empty store detected.

  [If bookmark exists]
    "Found backup folder: iCloud Drive › Lift Backups"
    [Restore from this folder]   [Pick a different folder]   [Start fresh]

  [If no bookmark]
    "Pick the folder where you previously saved Lift backups."
    [Pick folder]   [Start fresh]
```

On "Restore":
1. If no bookmark, prompt `pickFolder` first, persist bookmark.
2. `folderBridge.readFile(bookmark, "lift-backup.json")`.
3. If `not-found`: tell user "No `lift-backup.json` in that folder."
4. If found: feed contents into `importSnapshotJson(text, { mode: "replace" })` — same path the existing import screen uses ([mobile/src/screens/ImportExportScreen.tsx](../src/screens/ImportExportScreen.tsx)).
5. After successful import, run a fresh `runBackup("manual")` to confirm the round-trip.

### 7. Settings entry point

Add a row to the existing import/export screen ([mobile/src/screens/ImportExportScreen.tsx](../src/screens/ImportExportScreen.tsx)):

```
Automatic backup
  Folder: iCloud Drive › Lift Backups        [Change]
  Last backup: 3 minutes ago
  [⚠ Last backup failed: <reason>]            [Back up now]
```

If no bookmark configured: a single "Set up automatic backups" button that calls `pickFolder` and runs an initial backup.

## File-format note

Use the existing `buildJson` / `importSnapshotJson` round-trip — same format the manual export already produces. Don't invent a second format. The auto-backup is just the manual export, written automatically to a known filename.

Bonus: a user can manually share a backup from any other device (web export, friend's phone) into the same Files folder, and the next app open will offer to restore it.

## What this does not solve

- **User picks a folder, then deletes it from Files.** Next backup fails; surface the error and ask them to repick.
- **iCloud sync delay.** A reinstall immediately after a fresh save may see a stale `lift-backup.json` if iCloud hasn't synced yet. Mitigation: also keep a local copy of the last N snapshots in the sandbox; on reinstall the sandbox is gone anyway, so this only helps the "uninstall on different device, reinstall on first device" edge case. Probably not worth building until someone hits it.
- **User refuses to set up backups.** Same as today — sandbox-only, lost on delete. Add a recurring nag (every 7 days of use) until they configure it or explicitly dismiss.

## Build order

1. Native module (`pickFolder`, `writeFile`, `readFile`) — verify on a device, not just simulator (simulator has no real Files app).
2. JS bridge + backup settings in store.
3. `runBackup` runner + manual "Back up now" button. Ship this first; users can hit it manually and at least have a backup.
4. App-open + post-write triggers.
5. Restore flow on empty-store launch.
6. Nag banner for users without backups configured.

Each step is independently shippable. After step 3 a sideload user already has a working manual escape hatch; steps 4–6 just remove the friction.
