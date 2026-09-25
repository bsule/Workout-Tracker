"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { autoSync, type RemotePreview } from "@lift/core"
import { formatTimestamp } from "@lift/core/format"
import { Button } from "@/components/ui/button"

/**
 * Shown in place of the app when the signed-in account's store is empty, the
 * web copy of mobile's RestoreBackupScreen: pull the cloud copy down, or start
 * fresh. The web has no restore points, so cloud sync is the only source.
 */
export function RestoreBackupScreen({ onDismiss }: { onDismiss: () => void }) {
  const [busy, setBusy] = useState<null | "cloud-preview" | "cloud-apply">(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cloudPreview, setCloudPreview] = useState<RemotePreview | null>(null)

  async function loadCloudPreview() {
    setBusy("cloud-preview")
    setError(null)
    setInfo(null)
    try {
      const p = await autoSync.previewRemote()
      if (!p) {
        setError("No cloud backup yet for this account.")
        return
      }
      setCloudPreview(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  async function applyCloudPreview() {
    if (!cloudPreview) return
    setBusy("cloud-apply")
    setError(null)
    try {
      await autoSync.applyRemoteBytes(cloudPreview.bytes)
      setInfo("Restored from cloud. Continuing…")
      onDismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply cloud backup.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-4 py-10">
      <h1 className="text-xl font-bold tracking-tight">Restore from backup?</h1>
      <p className="text-xs leading-relaxed text-muted-foreground">
        This device has no workouts yet. Pull your data down from cloud sync,
        or start fresh.
      </p>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-[15px] font-semibold">Sync from cloud</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pull the latest snapshot from your account on the Lift cloud.
        </p>
        {cloudPreview ? (
          <>
            <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p>
                Last saved{" "}
                {cloudPreview.exportedAt
                  ? formatTimestamp(cloudPreview.exportedAt)
                  : "(unknown)"}
              </p>
              <p>
                {cloudPreview.workoutCount.toLocaleString()} workouts ·{" "}
                {cloudPreview.setCount.toLocaleString()} sets ·{" "}
                {cloudPreview.customExerciseCount.toLocaleString()} custom
                exercises · {cloudPreview.gymCount.toLocaleString()} gyms
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                onClick={() => setCloudPreview(null)}
                disabled={busy != null}
              >
                Cancel
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => void applyCloudPreview()}
                disabled={busy != null}
              >
                {busy === "cloud-apply" ? "Restoring…" : "Restore"}
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="lg"
            onClick={() => void loadCloudPreview()}
            disabled={busy != null}
          >
            {busy === "cloud-preview" && <Loader2 className="size-4 animate-spin" />}
            {busy === "cloud-preview" ? "Loading…" : "Sync from cloud"}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {info && <p className="text-sm text-muted-foreground">{info}</p>}

      <Button variant="outline" size="lg" onClick={onDismiss} disabled={busy != null}>
        Start fresh
      </Button>
    </div>
  )
}
