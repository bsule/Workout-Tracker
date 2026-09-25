"use client"

import { useEffect, useState } from "react"
import {
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
import { formatTimestamp } from "@lift/core/format"
import {
  SettingsCard,
  SettingsHeading,
  SettingsPage,
} from "@/components/settings/SettingRows"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"

/**
 * Cloud sync, the web half of mobile's Backup & Restore screen. Mobile also
 * lists restore points (older copies kept on the phone); the web keeps one
 * copy in browser storage, so it has none.
 */
export default function BackupRestorePage() {
  const [error, setError] = useState<string | null>(null)
  return (
    <SettingsPage
      title="Backup & Restore"
      subtitle="Sync keeps a copy of your data in the cloud."
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SettingsHeading>Cloud sync</SettingsHeading>
      <CloudSyncCard onError={setError} />
    </SettingsPage>
  )
}

function CloudSyncCard({ onError }: { onError: (msg: string | null) => void }) {
  const confirm = useConfirm()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [busy, setBusy] = useState<
    null | "sync" | "preview" | "apply" | "pull-stale" | "force-push"
  >(null)
  const [preview, setPreview] = useState<RemotePreview | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [clock, setClock] = useState<SyncClockSnapshot>(() => getSyncClock())

  useEffect(() => {
    autoSync.fetchQuota().then(setQuota).catch(() => {})
  }, [])

  // One clock for every sync path: the button below, and the daily check that
  // runs when the app opens. Subscribing keeps the label right either way.
  useEffect(() => {
    void loadSyncClock().then(setClock)
    return subscribeSyncClock(() => setClock(getSyncClock()))
  }, [])

  async function refreshQuota() {
    const q = await autoSync.fetchQuota().catch(() => null)
    if (q) setQuota(q)
  }

  async function syncNow() {
    setBusy("sync")
    setStatus(null)
    onError(null)
    try {
      // Yield so React paints the busy state before serialize() blocks the
      // main thread (JSON.stringify + gzipSync).
      await new Promise((r) => setTimeout(r, 0))
      const result = await autoSync.syncNow()
      if (result.kind === "stale") {
        // syncNow() recorded the conflict and CloudConflictPrompt owns the
        // dialog. The "ask once" rule covers background checks, not a button
        // press, so ask it to open even if this cloud version was seen.
        setStatus("Cloud has newer data. Pick one below.")
        requestCloudNewerPrompt()
        return
      }
      setStatus("Synced.")
      await refreshQuota()
    } catch (e) {
      if (e instanceof SyncQuotaExceededError) {
        setQuota(e.quota)
        onError(e.message)
      } else {
        onError(e instanceof Error ? e.message : "Sync failed.")
      }
    } finally {
      setBusy(null)
    }
  }

  async function pullCloudOverLocal() {
    // Mobile saves an undo copy before a pull; the web keeps one copy, so ask
    // first instead.
    const ok = await confirm({
      title: "Replace this device's data?",
      message: "The cloud copy replaces everything here. Changes not pushed yet will be gone.",
      destructive: true,
      confirmLabel: "Get cloud",
    })
    if (!ok) return
    setBusy("pull-stale")
    onError(null)
    try {
      const applied = await autoSync.pullAndReplace()
      setStatus(applied ? "Replaced local with cloud copy." : "No cloud backup found.")
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't pull cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  async function overwriteCloud() {
    const ok = await confirm({
      title: "Overwrite the cloud copy?",
      message: "The cloud's newer changes will be gone. This cannot be undone.",
      destructive: true,
      confirmLabel: "Overwrite",
    })
    if (!ok) return
    setBusy("force-push")
    onError(null)
    try {
      await new Promise((r) => setTimeout(r, 0))
      await autoSync.forcePush()
      setStatus("Overwrote cloud with this device's data.")
      await refreshQuota()
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
    const ok = await confirm({
      title: "Replace local data with cloud?",
      message:
        "This wipes every workout, exercise, and set on this device, then loads the cloud copy. Cannot be undone.",
      destructive: true,
      confirmLabel: "Replace",
    })
    if (!ok) return
    setBusy("apply")
    try {
      await autoSync.applyRemoteBytes(preview.bytes)
      setPreview(null)
      setStatus("Loaded cloud copy.")
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't apply cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  const pushDisabled = busy != null || (quota != null && quota.remaining <= 0)
  // Web keeps the reset time next to the count (mobile shows the count only).
  const resetsAt = quota?.resets_at ? formatResetTime(quota.resets_at) : null

  return (
    <SettingsCard>
      <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          Push this device&apos;s data to the cloud, or pull a previous backup
          down. Pushing is limited to 5 syncs per day.
        </p>
        <p>
          {quota == null
            ? "Loading quota…"
            : `${quota.remaining} of ${quota.limit} syncs left today${
                resetsAt ? ` · resets ${resetsAt}` : ""
              }`}
        </p>
        <p>{formatLastSynced(clock.lastSyncedAt)}</p>
        {clock.cloudNewerAt !== null && (
          <>
            <p className="text-destructive">
              Cloud has newer data from another device. Automatic sync is paused
              until you pick one.
            </p>
            <div className="flex gap-3">
              <Button
                size="lg"
                className="flex-1"
                onClick={() => void pullCloudOverLocal()}
                disabled={busy != null}
              >
                {busy === "pull-stale" ? "Getting…" : "Get cloud"}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                className="flex-1"
                onClick={() => void overwriteCloud()}
                disabled={busy != null}
              >
                {busy === "force-push" ? "Overwriting…" : "Overwrite cloud"}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => void syncNow()}
          disabled={pushDisabled}
        >
          {busy === "sync"
            ? "Syncing…"
            : busy === "force-push"
              ? "Overwriting…"
              : busy === "pull-stale"
                ? "Pulling…"
                : "Sync now"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          onClick={() => void loadPreview()}
          disabled={busy != null}
        >
          {busy === "preview" ? "Loading…" : "Import from cloud"}
        </Button>
      </div>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {preview && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-[15px] font-semibold">Cloud backup</p>
          <p className="text-xs text-muted-foreground">
            Last saved{" "}
            {preview.exportedAt ? formatTimestamp(preview.exportedAt) : "(unknown)"}
          </p>
          <p className="text-xs text-muted-foreground">
            {preview.workoutCount.toLocaleString()} workouts ·{" "}
            {preview.setCount.toLocaleString()} sets ·{" "}
            {preview.customExerciseCount.toLocaleString()} custom exercises ·{" "}
            {preview.gymCount.toLocaleString()} gyms
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => setPreview(null)}
              disabled={busy === "apply"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="flex-1"
              onClick={() => void applyPreview()}
              disabled={busy === "apply"}
            >
              {busy === "apply" ? "Replacing…" : "Replace local"}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function formatResetTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "soon"
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  return (
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) +
    (sameDay ? "" : " (next day UTC)")
  )
}
