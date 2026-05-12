import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import {
  autoSync,
  SyncQuotaExceededError,
  useStore,
  type Quota,
  type RemotePreview,
} from "@lift/core"
import { buildJson, timestampedExportName } from "@lift/core/export"
import { writeFitnotesDbToCache } from "../exports/fitnotesDb"
import {
  importFitnotesCsv,
  importSnapshotJson,
  previewFitnotesCsv,
  previewSnapshotJson,
  type ImportMode,
  type ImportResult,
} from "@lift/core/import"
import { useAuth } from "../auth/AuthProvider"
import {
  loadBackupState,
  saveBackupState,
  subscribeBackupState,
  type BackupState,
} from "../backup/backupState"
import { folderBridge, isBackupFolderAvailable } from "../backup/folderBridge"
import { runBackup } from "../backup/runner"
import { Button } from "../components/Button"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"

type PendingImport =
  | {
      kind: "snapshot"
      uri: string
      text: string
      workoutCount: number
      setCount: number
      customExerciseCount: number
      gymCount: number
      exportedAt: string | null
    }
  | {
      kind: "fitnotes"
      uri: string
      text: string
      rowCount: number
    }

export function ImportExportScreen() {
  const { user } = useAuth()
  const snapshot = useStore((s) => s.snapshot)

  const [busy, setBusy] = useState<
    null | "json" | "fitnotesdb" | "pick" | "import"
  >(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [mode, setMode] = useState<ImportMode>("merge")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function shareFile(filename: string, body: string, mime: string) {
    const uri = (FileSystem.cacheDirectory ?? "") + filename
    await FileSystem.writeAsStringAsync(uri, body)
    const available = await Sharing.isAvailableAsync()
    if (!available) {
      Alert.alert(
        "Sharing unavailable",
        `File saved to ${uri}, but the share sheet isn't available on this device.`
      )
      return
    }
    await Sharing.shareAsync(uri, { mimeType: mime, UTI: undefined })
  }

  async function exportJson() {
    setBusy("json")
    setError(null)
    try {
      const filename = timestampedExportName("json")
      const body = buildJson(snapshot, user?.username ?? "")
      await shareFile(filename, body, "application/json")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setBusy(null)
    }
  }

  async function exportFitnotesDb() {
    setBusy("fitnotesdb")
    setError(null)
    try {
      const { uri, filename } = await writeFitnotesDbToCache(snapshot)
      const available = await Sharing.isAvailableAsync()
      if (!available) {
        Alert.alert(
          "Sharing unavailable",
          `File saved to ${uri}, but the share sheet isn't available on this device.`
        )
        return
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/zip",
        UTI: "public.zip-archive",
        dialogTitle: filename,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setBusy(null)
    }
  }

  async function pickAndPreview() {
    setBusy("pick")
    setError(null)
    setResult(null)
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/csv", "text/comma-separated-values", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (res.canceled) return
      const asset = res.assets?.[0]
      if (!asset) return
      const text = await FileSystem.readAsStringAsync(asset.uri)
      const looksJson = looksLikeJson(text)
      if (looksJson) {
        const p = previewSnapshotJson(text)
        if (p.format !== "lift-snapshot") {
          setError(
            p.reason ??
              "JSON file doesn't match the Lift backup format. Pick a file exported from Lift."
          )
          return
        }
        setPending({
          kind: "snapshot",
          uri: asset.uri,
          text,
          workoutCount: p.workoutCount,
          setCount: p.setCount,
          customExerciseCount: p.customExerciseCount,
          gymCount: p.gymCount,
          exportedAt: p.exportedAt,
        })
      } else {
        const p = previewFitnotesCsv(text)
        if (p.format !== "fitnotes") {
          setError(
            "CSV header didn't match the FitNotes format. Headers required: Date, Exercise, Category, Weight (kg), Weight (lbs), Reps, Distance, Distance Unit, Time, Notes, Kind."
          )
          return
        }
        setPending({
          kind: "fitnotes",
          uri: asset.uri,
          text,
          rowCount: p.rowCount,
        })
      }
      setMode("merge")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read file.")
    } finally {
      setBusy(null)
    }
  }

  async function runImport() {
    if (!pending) return
    if (mode === "replace") {
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Replace everything?",
          "This permanently deletes every workout, exercise, and set currently in the app, then loads the file. Settings are kept. This cannot be undone.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            {
              text: "Replace",
              style: "destructive",
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        )
      })
      if (!ok) return
    }
    setBusy("import")
    setError(null)
    try {
      const res =
        pending.kind === "snapshot"
          ? await importSnapshotJson(pending.text, { mode })
          : await importFitnotesCsv(pending.text, { mode })
      setResult(res)
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.")
    } finally {
      setBusy(null)
    }
  }

  function clearResult() {
    setResult(null)
  }

  const exportDisabled = busy != null
  const importDisabled = busy != null && busy !== "import"

  return (
    <StaticSafeAreaView>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.subtitle}>
          Back up your workouts, share them as a file, or restore from a
          previous backup. Cloud sync is opt-in.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.section}>Cloud sync</Text>
        <CloudSyncCard onError={setError} />

        <Text style={styles.section}>Automatic backup</Text>
        <BackupCard onError={setError} />

        <Text style={styles.section}>Export</Text>
        <View style={styles.card}>
          <View style={{ gap: theme.spacing[2] }}>
            <Text style={styles.rowTitle}>Lift JSON backup</Text>
            <Text style={styles.help}>
              Full snapshot — workouts, custom exercises, saved gyms. Re-importable
              on Lift mobile or web.
            </Text>
          </View>
          <Button
            label={busy === "json" ? "Preparing…" : "Export JSON"}
            onPress={exportJson}
            disabled={exportDisabled}
          />
        </View>

        <View style={styles.card}>
          <View style={{ gap: theme.spacing[2] }}>
            <Text style={styles.rowTitle}>FitNotes-compatible DB</Text>
            <Text style={styles.help}>
              A .fitnotesdb file you can side-load into FitNotes for iOS.
              Distance, time, notes, and exercise kind are all preserved.
            </Text>
          </View>
          <Button
            label={busy === "fitnotesdb" ? "Preparing…" : "Export FitNotes DB"}
            onPress={exportFitnotesDb}
            disabled={exportDisabled}
          />
        </View>

        <Text style={styles.section}>Import</Text>
        <View style={styles.card}>
          <Text style={styles.help}>
            Pick a Lift JSON backup or a FitNotes Android CSV export. The format
            is detected automatically.
          </Text>
          <Button
            label={busy === "pick" ? "Reading…" : "Choose file"}
            onPress={pickAndPreview}
            disabled={importDisabled}
          />
        </View>

        {pending && (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>
              {pending.kind === "snapshot"
                ? "Lift backup detected"
                : "FitNotes export detected"}
            </Text>
            {pending.kind === "snapshot" ? (
              <Text style={styles.help}>
                {pending.workoutCount.toLocaleString()} workouts ·{" "}
                {pending.setCount.toLocaleString()} sets ·{" "}
                {pending.customExerciseCount.toLocaleString()} custom exercises
                · {pending.gymCount.toLocaleString()} gyms
                {pending.exportedAt
                  ? ` · exported ${formatExportedAt(pending.exportedAt)}`
                  : ""}
              </Text>
            ) : (
              <Text style={styles.help}>
                {pending.rowCount.toLocaleString()} sets ready to import.
              </Text>
            )}

            <View style={{ gap: theme.spacing[2] }}>
              <ModeRow
                title="Add to my existing data"
                description="Merge: workouts on the same date+gym and exercises with the same name are reused."
                checked={mode === "merge"}
                onSelect={() => setMode("merge")}
                disabled={busy === "import"}
              />
              <ModeRow
                title="Replace everything"
                description="Wipes all current workouts, exercises, sets, and PRs. Settings are kept. Cannot be undone."
                checked={mode === "replace"}
                onSelect={() => setMode("replace")}
                disabled={busy === "import"}
                destructive
              />
            </View>

            <View style={styles.actionsRow}>
              <Button
                label="Cancel"
                style={{ flex: 1 }}
                onPress={() => setPending(null)}
                disabled={busy === "import"}
              />
              <Button
                label={
                  busy === "import"
                    ? mode === "replace"
                      ? "Replacing…"
                      : "Importing…"
                    : mode === "replace"
                      ? "Replace"
                      : "Import"
                }
                variant={mode === "replace" ? "destructive" : "primary"}
                style={{ flex: 1 }}
                onPress={runImport}
                disabled={busy === "import"}
              />
            </View>
          </View>
        )}

        {result && (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>
              {result.imported.toLocaleString()} sets imported
            </Text>
            {result.exercisesCreated.length > 0 && (
              <Text style={styles.help}>
                Created {result.exercisesCreated.length} new custom exercise
                {result.exercisesCreated.length === 1 ? "" : "s"}:{" "}
                {result.exercisesCreated.join(", ")}
              </Text>
            )}
            {result.errors.length > 0 && (
              <Text style={styles.help}>
                {result.errors.length} row
                {result.errors.length === 1 ? "" : "s"} skipped. First few:{" "}
                {result.errors
                  .slice(0, 3)
                  .map((e) => `row ${e.row}: ${e.message}`)
                  .join(" · ")}
              </Text>
            )}
            <Button label="Done" onPress={clearResult} />
          </View>
        )}

        {busy === "import" && (
          <View style={styles.busyOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={theme.colors.foreground} />
          </View>
        )}
      </ScrollView>
    </StaticSafeAreaView>
  )
}

function ModeRow({
  title,
  description,
  checked,
  onSelect,
  disabled,
  destructive,
}: {
  title: string
  description: string
  checked: boolean
  onSelect: () => void
  disabled: boolean
  destructive?: boolean
}) {
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled}
      style={({ pressed }) => [
        styles.modeRow,
        checked && {
          borderColor: destructive
            ? theme.colors.destructive
            : theme.colors.foreground,
        },
        pressed && !disabled && { opacity: 0.85 },
        disabled && { opacity: 0.6 },
      ]}
    >
      <View
        style={[
          styles.radio,
          checked && {
            backgroundColor: destructive
              ? theme.colors.destructive
              : theme.colors.foreground,
            borderColor: destructive
              ? theme.colors.destructive
              : theme.colors.foreground,
          },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.modeTitle}>{title}</Text>
        <Text style={styles.help}>{description}</Text>
      </View>
    </Pressable>
  )
}

function CloudSyncCard({ onError }: { onError: (msg: string | null) => void }) {
  const { user } = useAuth()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [busy, setBusy] = useState<
    null | "sync" | "preview" | "apply" | "pull-stale" | "force-push"
  >(null)
  const [preview, setPreview] = useState<RemotePreview | null>(null)
  const [status, setStatus] = useState<
    | { kind: "ok" | "info"; msg: string }
    | null
  >(null)

  useEffect(() => {
    if (!user) return
    autoSync.fetchQuota().then(setQuota).catch(() => {})
  }, [user])

  if (!user) {
    return (
      <View style={styles.card}>
        <Text style={styles.help}>
          Sign in to sync your workouts to the cloud and restore them on
          another device.
        </Text>
      </View>
    )
  }

  async function syncNow() {
    setBusy("sync")
    setStatus(null)
    onError(null)
    try {
      // Yield so React commits the busy state before serialize() blocks
      // the JS thread (gzipSync + JSON.stringify).
      await new Promise((r) => setTimeout(r, 0))
      const result = await autoSync.syncNow()
      if (result.kind === "stale") {
        setBusy(null)
        promptStaleResolution()
        return
      }
      setStatus({ kind: "ok", msg: "Synced." })
      const q = await autoSync.fetchQuota().catch(() => null)
      if (q) setQuota(q)
    } catch (e) {
      if (e instanceof SyncQuotaExceededError) {
        setQuota(e.quota)
        onError(e.message)
      } else {
        onError(e instanceof Error ? e.message : "Sync failed.")
      }
    } finally {
      setBusy((b) => (b === "sync" ? null : b))
    }
  }

  function promptStaleResolution() {
    Alert.alert(
      "Cloud is newer",
      "Your cloud backup has changes that aren't on this device. Pull cloud down (replaces local) or overwrite cloud with this device's data?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Get cloud", onPress: () => void pullCloudOverLocal() },
        {
          text: "Overwrite cloud",
          style: "destructive",
          onPress: () => void overwriteCloud(),
        },
      ],
      { cancelable: true }
    )
  }

  async function pullCloudOverLocal() {
    setBusy("pull-stale")
    onError(null)
    try {
      const applied = await autoSync.pullAndReplace()
      setStatus({
        kind: "info",
        msg: applied
          ? "Replaced local with cloud copy."
          : "No cloud backup found.",
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't pull cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  async function overwriteCloud() {
    setBusy("force-push")
    onError(null)
    try {
      await new Promise((r) => setTimeout(r, 0))
      await autoSync.forcePush()
      setStatus({ kind: "ok", msg: "Overwrote cloud with this device's data." })
      const q = await autoSync.fetchQuota().catch(() => null)
      if (q) setQuota(q)
    } catch (e) {
      if (e instanceof SyncQuotaExceededError) {
        setQuota(e.quota)
        onError(e.message)
      } else {
        onError(e instanceof Error ? e.message : "Couldn't overwrite cloud.")
      }
    } finally {
      setBusy(null)
    }
  }

  async function loadPreview() {
    setBusy("preview")
    setStatus(null)
    onError(null)
    try {
      const p = await autoSync.previewRemote()
      if (!p) {
        onError("No cloud backup yet. Sync now to upload your first snapshot.")
        return
      }
      setPreview(p)
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't load cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  async function applyPreview() {
    if (!preview) return
    const ok = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Replace local data with cloud?",
        "This wipes every workout, exercise, and set on this device, then loads the cloud copy. Cannot be undone.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      )
    })
    if (!ok) return
    setBusy("apply")
    try {
      await autoSync.applyRemoteBytes(preview.bytes)
      setPreview(null)
      setStatus({ kind: "ok", msg: "Loaded cloud copy." })
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't apply cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  const pushDisabled =
    busy != null || (quota != null && quota.remaining <= 0)

  return (
    <View style={styles.card}>
      <View style={{ gap: theme.spacing[2] }}>
        <Text style={styles.help}>
          Push this device's data to the cloud, or pull a previous backup down.
          Pushing is limited to 5 syncs per day.
        </Text>
        <Text style={styles.help}>
          {quota == null
            ? "Loading quota…"
            : `${quota.remaining} of ${quota.limit} syncs left today`}
        </Text>
      </View>

      <View style={styles.actionsRow}>
        <Button
          label={
            busy === "sync"
              ? "Syncing…"
              : busy === "force-push"
                ? "Overwriting…"
                : busy === "pull-stale"
                  ? "Pulling…"
                  : "Sync now"
          }
          onPress={syncNow}
          disabled={pushDisabled}
          style={{ flex: 1 }}
        />
        <Button
          label={busy === "preview" ? "Loading…" : "Import from cloud"}
          onPress={loadPreview}
          disabled={busy != null}
          style={{ flex: 1 }}
        />
      </View>

      {status && (
        <Text style={styles.help}>{status.msg}</Text>
      )}

      {preview && (
        <View style={styles.previewBox}>
          <Text style={styles.rowTitle}>Cloud backup</Text>
          <Text style={styles.help}>
            Last saved{" "}
            {preview.exportedAt
              ? formatExportedAt(preview.exportedAt)
              : "(unknown)"}
          </Text>
          <Text style={styles.help}>
            {preview.workoutCount.toLocaleString()} workouts ·{" "}
            {preview.setCount.toLocaleString()} sets ·{" "}
            {preview.customExerciseCount.toLocaleString()} custom exercises ·{" "}
            {preview.gymCount.toLocaleString()} gyms
          </Text>
          <View style={styles.actionsRow}>
            <Button
              label="Cancel"
              style={{ flex: 1 }}
              onPress={() => setPreview(null)}
              disabled={busy === "apply"}
            />
            <Button
              label={busy === "apply" ? "Replacing…" : "Replace local"}
              variant="destructive"
              style={{ flex: 1 }}
              onPress={applyPreview}
              disabled={busy === "apply"}
            />
          </View>
        </View>
      )}
    </View>
  )
}

function BackupCard({ onError }: { onError: (msg: string | null) => void }) {
  const [state, setState] = useState<BackupState | null>(null)
  const [busy, setBusy] = useState<null | "setup" | "backup" | "change">(null)

  useEffect(() => {
    void loadBackupState().then(setState)
    return subscribeBackupState(setState)
  }, [])

  async function pickAndSave(after?: () => Promise<unknown>) {
    const picked = await folderBridge.pickFolder()
    if (!picked) return null
    const next = await saveBackupState({
      bookmark: picked.bookmark,
      folderLabel: picked.label,
      lastBackupError: null,
    })
    if (after) await after()
    return next
  }

  async function setupBackups() {
    setBusy("setup")
    onError(null)
    try {
      await pickAndSave(async () => {
        await runBackup("manual")
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't set up backups.")
    } finally {
      setBusy(null)
    }
  }

  async function backupNow() {
    setBusy("backup")
    onError(null)
    try {
      const outcome = await runBackup("manual")
      if (outcome === "error") {
        onError("Backup failed. Check the folder still exists in Files.")
      }
    } finally {
      setBusy(null)
    }
  }

  async function changeFolder() {
    setBusy("change")
    onError(null)
    try {
      await pickAndSave(async () => {
        await runBackup("manual")
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't change folder.")
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={theme.colors.muted} />
      </View>
    )
  }

  if (!isBackupFolderAvailable()) {
    return (
      <View style={styles.card}>
        <Text style={styles.rowTitle}>Available in custom builds</Text>
        <Text style={styles.help}>
          Saving backups to the Files app needs a custom development build —
          Expo Go can't load the iOS folder picker. Use Import / Export below
          for one-off backups in the meantime.
        </Text>
      </View>
    )
  }

  if (!state.bookmark) {
    return (
      <View style={styles.card}>
        <View style={{ gap: theme.spacing[2] }}>
          <Text style={styles.rowTitle}>Save backups to Files</Text>
          <Text style={styles.help}>
            Pick a folder in iCloud Drive or On My iPhone. The app saves a
            full backup there after every workout, so reinstalling never loses
            your data.
          </Text>
        </View>
        <Button
          label={busy === "setup" ? "Opening picker…" : "Set up automatic backups"}
          onPress={setupBackups}
          disabled={busy != null}
        />
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <View style={{ gap: theme.spacing[2] }}>
        <Text style={styles.rowTitle}>{state.folderLabel ?? "Backup folder"}</Text>
        <Text style={styles.help}>
          Last backup: {formatRelativeTime(state.lastBackupAt)}
        </Text>
      </View>
      {state.lastBackupError && (
        <Text style={styles.error}>Last backup failed: {state.lastBackupError}</Text>
      )}
      <View style={styles.actionsRow}>
        <Button
          label={busy === "backup" ? "Backing up…" : "Back up now"}
          onPress={backupNow}
          disabled={busy != null}
          style={{ flex: 1 }}
        />
        <Button
          label={busy === "change" ? "Opening picker…" : "Change folder"}
          onPress={changeFolder}
          disabled={busy != null}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  )
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const seconds = Math.floor((Date.now() - t) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return new Date(t).toLocaleString()
}

function looksLikeJson(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0xfeff) continue
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue
    return text[i] === "{" || text[i] === "["
  }
  return false
}

function formatExportedAt(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  section: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: theme.spacing[3],
  },
  card: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  help: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  modeRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing[3],
  },
  modeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginBottom: 2,
  },
  radio: {
    marginTop: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
  },
  busyOverlay: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  previewBox: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
})
