"use client"

import { useCallback, useEffect, useState } from "react"
import { formatTimestamp } from "@lift/core/format"
import type { SnapshotStats } from "@lift/core/store/storage"
import type { RestoreSlot } from "@/lib/store/storage/recovery"
import { subscribeRestorePoints } from "@/lib/store/storage/recovery"
import { listRestorePoints, restoreFromSlot } from "@/lib/store/restorePoints"
import { SettingsCard, SettingsHeading } from "@/components/settings/SettingRows"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { Button } from "@/components/ui/button"

const labels: Record<RestoreSlot, string> = {
  previous: "Previous save", daily: "Daily restore point", undo: "Before last import or restore",
}

export function LocalRestorePoints({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const confirm = useConfirm()
  const [points, setPoints] = useState<Partial<Record<RestoreSlot, SnapshotStats>>>({})
  const [busy, setBusy] = useState<RestoreSlot | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => listRestorePoints().then(setPoints).catch((e: unknown) => {
    setError(e instanceof Error ? e.message : "Could not read restore points.")
  }), [])
  useEffect(() => {
    void refresh()
    return subscribeRestorePoints(() => { void refresh() })
  }, [refresh])

  async function restore(slot: RestoreSlot) {
    if (disabled || busy) return
    setBusy(slot)
    onBusyChange?.(true)
    try {
      if (!await confirm({ title: `Restore ${labels[slot].toLowerCase()}?`, message: "This replaces the workouts on this browser. An undo copy is kept in local restore points.", confirmLabel: "Restore" })) return
      setError(null)
      await restoreFromSlot(slot)
      setStatus("Restored local copy.")
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : "Restore failed.") }
    finally { setBusy(null); onBusyChange?.(false) }
  }

  return (
    <>
      <SettingsHeading>Local restore points</SettingsHeading>
      <SettingsCard>
        <p className="text-xs text-muted-foreground">Older copies saved in this browser. A recovery copy is also saved before replacing data from a file or the cloud. Clearing site data removes these copies.</p>
        {(["previous", "daily", "undo"] as const).map((slot) => {
          const point = points[slot]
          if (!point) return null
          return (
            <div key={slot} className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{labels[slot]}</p>
                <p className="text-xs text-muted-foreground">{formatTimestamp(point.savedAt)}</p>
                <p className="text-xs text-muted-foreground">{point.workouts.toLocaleString()} workouts · {point.sets.toLocaleString()} sets</p>
              </div>
              <Button variant="outline" disabled={disabled || busy !== null} onClick={() => void restore(slot)}>{busy === slot ? "Restoring…" : "Restore"}</Button>
            </div>
          )
        })}
        {!Object.values(points).some(Boolean) && <p className="text-xs text-muted-foreground">Restore points appear after your next save.</p>}
        {status && <p role="status" className="text-xs text-secondary">{status}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </SettingsCard>
    </>
  )
}
