import { useScreenSnapshot } from "../store/useScreenSnapshot"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useFocusEffect } from "@react-navigation/native"
import {
  addFlushListener,
  autoSync,
  formatLastSynced,
  getSyncClock,
  loadSyncClock,
  requestCloudNewerPrompt,
  subscribeSyncClock,
  SyncQuotaExceededError,
  type Quota,
  type RemotePreview,
  type SyncClockSnapshot,
} from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import {
  listRestorePoints,
  restoreFromSlot,
  type RestorableSlot,
} from "../store/restorePoints"
import type { RestoreMeta, SlotInfo } from "../store/storage"
import { Button } from "../components/Button"
import { theme } from "../theme/theme"
import { formatTimestamp } from "../format"
import { Card } from "../components/Card"

/**
 * Keeping the data and getting it back: cloud sync (the copy off the phone)
 * and the local restore points (older copies on the phone). File import and
 * export stay on the Import / Export screen.
 */
export function BackupRestoreScreen() {
  const [error, setError] = useState<string | null>(null)
  return (
    // Pushed route with a native header, which already clears the status
    // bar. StaticSafeAreaView would pad the top a second time.
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.subtitle}>
          Sync keeps a copy of your data in the cloud. Restore points are older
          copies on this phone, for when you change or delete something by
          mistake.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.section}>Cloud sync</Text>
        <CloudSyncCard onError={setError} />

        <Text style={styles.section}>Restore points</Text>
        <RestorePointsCard onError={setError} />
      </ScrollView>
    </View>
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
  const [clock, setClock] = useState<SyncClockSnapshot>(() => getSyncClock())

  useEffect(() => {
    if (!user) return
    autoSync.fetchQuota().then(setQuota).catch(() => {})
  }, [user])

  // One clock for every sync path: the button below, and the daily check that
  // runs when the app opens. Subscribing keeps the label right either way.
  useEffect(() => {
    void loadSyncClock().then(setClock)
    return subscribeSyncClock(() => setClock(getSyncClock()))
  }, [])

  if (!user) {
    return (
      <Card>
        <Text style={styles.help}>
          Sign in to sync your workouts to the cloud and restore them on
          another device.
        </Text>
      </Card>
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
        // syncNow() recorded the conflict. CloudConflictPrompt owns the alert,
        // so this screen opens none of its own — two alerts raced before. The
        // "ask once" rule covers background checks, not a button press, so ask
        // it to open even if the user already saw it for this cloud version.
        setBusy(null)
        setStatus({ kind: "info", msg: "Cloud has newer data. Pick one below." })
        requestCloudNewerPrompt()
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

  function confirmOverwriteCloud() {
    Alert.alert(
      "Overwrite the cloud copy?",
      "The cloud's newer changes will be gone. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Overwrite",
          style: "destructive",
          onPress: () => void overwriteCloud(),
        },
      ],
      { cancelable: true }
    )
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
    <Card>
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
        <Text style={styles.help}>{formatLastSynced(clock.lastSyncedAt)}</Text>
        {clock.cloudNewerAt !== null && (
          <>
            <Text style={[styles.help, { color: theme.colors.destructive }]}>
              Cloud has newer data from another device. Automatic sync is paused
              until you pick one.
            </Text>
            <View style={styles.actionsRow}>
              <Button
                label={busy === "pull-stale" ? "Getting…" : "Get cloud"}
                onPress={() => void pullCloudOverLocal()}
                disabled={busy != null}
                style={{ flex: 1 }}
              />
              <Button
                label={busy === "force-push" ? "Overwriting…" : "Overwrite cloud"}
                variant="destructive"
                onPress={confirmOverwriteCloud}
                disabled={busy != null}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
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
              ? formatTimestamp(preview.exportedAt)
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
    </Card>
  )
}

const RESTORE_SLOTS: { slot: RestorableSlot; title: string; help: string }[] = [
  {
    slot: "bak",
    title: "Last save",
    help: "Your data before the most recent save.",
  },
  {
    slot: "bak2",
    title: "Daily restore point",
    help: "Held for at least a day, then moves forward on the next save.",
  },
  {
    slot: "undo",
    title: "Before last restore",
    help: "The data your last restore replaced. Restore it to undo.",
  },
]

function RestorePointsCard({ onError }: { onError: (msg: string | null) => void }) {
  const current = useScreenSnapshot()
  const [meta, setMeta] = useState<RestoreMeta | null>(null)
  const [busy, setBusy] = useState<RestorableSlot | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const reload = useCallback(() => {
    listRestorePoints()
      .then(setMeta)
      .catch((e) => {
        setMeta({})
        onError(e instanceof Error ? e.message : "Couldn't read restore points.")
      })
  }, [onError])

  // Saves happen while the user is elsewhere; refresh on every visit. A save
  // also rotates the files while this screen is open (every flush, and
  // flushOnHide when the app goes to the background), so refresh on those too.
  useFocusEffect(reload)
  useEffect(() => {
    const offFlush = addFlushListener(reload)
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") reload()
    })
    return () => {
      offFlush()
      sub.remove()
    }
  }, [reload])

  // One confirm at a time: a fast double tap would otherwise stack two.
  const confirming = useRef(false)

  function confirmRestore(slot: RestorableSlot, title: string, point: SlotInfo) {
    if (confirming.current) return
    confirming.current = true
    const done = () => {
      confirming.current = false
    }
    Alert.alert(
      `Restore "${title}"?`,
      `Your current data is replaced with the copy from ${formatTimestamp(point.savedAt)}. ` +
        "You can undo this from the same list.",
      [
        { text: "Cancel", style: "cancel", onPress: done },
        {
          text: "Restore",
          style: "destructive",
          onPress: () => {
            done()
            void runRestore(slot)
          },
        },
      ],
      { cancelable: true, onDismiss: done }
    )
  }

  async function runRestore(slot: RestorableSlot) {
    setBusy(slot)
    setInfo(null)
    onError(null)
    try {
      await restoreFromSlot(slot)
      setInfo("Restored.")
    } catch (e) {
      onError(e instanceof Error ? e.message : "Restore failed.")
    } finally {
      setBusy(null)
      reload()
    }
  }

  if (!meta) {
    return (
      <Card>
        <ActivityIndicator color={theme.colors.muted} />
      </Card>
    )
  }

  const available = RESTORE_SLOTS.filter((r) => meta[r.slot])
  const liveSets = current.sets.reduce((n, row) => (row.is_planned ? n : n + 1), 0)

  return (
    <Card>
      <View style={{ gap: theme.spacing[2] }}>
        <Text style={styles.rowTitle}>Current data</Text>
        <Text style={styles.help}>
          {countsLine(current.workouts.length, liveSets)}
        </Text>
        <Text style={styles.help}>
          The app keeps older copies of your data on this phone. Restore one
          if you change or delete something by mistake.
        </Text>
      </View>
      {available.length === 0 && (
        <Text style={styles.help}>No older copies yet. They appear after your next save.</Text>
      )}
      {available.map(({ slot, title, help }) => {
        const point = meta[slot]!
        return (
          <View key={slot} style={styles.previewBox}>
            <Text style={styles.rowTitle}>{title}</Text>
            <Text style={styles.help}>
              {formatRelativeTime(point.savedAt)} · {countsLine(point.workouts, point.sets)}
            </Text>
            <Text style={styles.help}>{help}</Text>
            <Button
              label={busy === slot ? "Restoring…" : "Restore"}
              variant="secondary"
              onPress={() => confirmRestore(slot, title, point)}
              disabled={busy != null}
            />
          </View>
        )
      })}
      {info && <Text style={styles.help}>{info}</Text>}
    </Card>
  )
}

function countsLine(workouts: number | null, sets: number | null): string {
  if (workouts == null || sets == null) return "Counts unknown"
  return `${workouts.toLocaleString()} workouts · ${sets.toLocaleString()} sets`
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
