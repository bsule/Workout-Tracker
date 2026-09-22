"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import {
  autoSync,
  formatLastSynced,
  getSyncClock,
  loadSyncClock,
  markCloudNewerPrompted,
  shouldPromptCloudNewer,
  subscribeSyncClock,
  useStore,
  type RemotePreview,
} from "@lift/core"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth/AuthProvider"
import { cn } from "@/lib/utils"

/**
 * Tells the user, once, that a push was refused because the cloud moved ahead.
 *
 * Nothing was overwritten — the server rejects a stale push on its If-Match
 * precondition (cloudflare/src/sync/routes.ts). But the automatic daily sync
 * runs at browser idle, so without this the refusal would be invisible until
 * the user happened to open Settings.
 *
 * It asks once per distinct cloud version: markCloudNewerPrompted() fires when
 * the dialog opens, not when it is answered, so dismissing it, ignoring it, or
 * closing the tab all count as told. The quiet marker in Settings stays behind
 * for whenever the user wants to deal with it.
 */
export function CloudConflictPrompt() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<null | "pull" | "push">(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // This dialog arrives unbidden, over whatever page the user is on, so the
  // destructive choice gets a second step. The Settings button does not need
  // one — you go there on purpose.
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  // The cloud copy's save time and size — the facts that decide which to keep.
  // Pulls are unrestricted, so reading it costs no daily sync budget, and the
  // bytes are reused if the user takes the cloud copy.
  const [preview, setPreview] = useState<RemotePreview | null>(null)
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "failed">(
    "loading"
  )
  const snapshot = useStore((s) => s.snapshot)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    function check() {
      if (cancelled) return
      setOpen((wasOpen) => {
        if (wasOpen) return true
        if (!shouldPromptCloudNewer()) return false
        // Mark before showing: being asked is what counts, not answering.
        markCloudNewerPrompted()
        return true
      })
    }

    // The conflict may already be on disk from a previous session.
    void loadSyncClock().then(check)
    const unsubscribe = subscribeSyncClock(check)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [user])

  // Load the comparison once the dialog is up, so it opens with no delay.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    autoSync
      .previewRemote()
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        setPreviewState(p ? "ready" : "failed")
      })
      .catch(() => {
        if (!cancelled) setPreviewState("failed")
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const closeDialog = useCallback(() => {
    setOpen(false)
    setConfirmOverwrite(false)
    setPreview(null)
    setPreviewState("loading")
  }, [])

  const resolve = useCallback(async (choice: "pull" | "push") => {
    setBusy(choice)
    setError(null)
    try {
      if (choice === "pull") {
        if (preview) {
          // Already downloaded for the comparison; don't fetch it twice.
          await autoSync.applyRemoteBytes(preview.bytes)
          setDone("This device now matches the cloud.")
          return
        }
        const applied = await autoSync.pullAndReplace()
        setDone(
          applied
            ? "This device now matches the cloud."
            : "Nothing to pull. The cloud is empty."
        )
      } else {
        await autoSync.forcePush()
        setDone("The cloud now matches this device.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server.")
    } finally {
      setBusy(null)
    }
  }, [preview])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Cloud has newer data"
    >
      <div
        className={cn(
          "w-full max-w-md overflow-hidden rounded-2xl border border-white/10",
          "bg-card text-foreground shadow-2xl"
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <div className="flex-1 pt-0.5">
            <h2 className="text-base font-semibold tracking-tight">
              {done
                ? "Sorted"
                : confirmOverwrite
                  ? "Overwrite the cloud copy?"
                  : "Cloud has newer data"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {done ??
                (confirmOverwrite
                  ? "The other device's newer changes will be gone. This cannot be undone."
                  : "Another device pushed changes this one hasn't seen, so the automatic sync was refused. Nothing was lost. Get the cloud copy, or overwrite it with this device's data?")}
            </p>
            {!done && !confirmOverwrite && (
              <dl className="mt-3 space-y-1.5 rounded-md border border-white/10 bg-white/[.02] p-3 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="font-medium">Cloud copy</dt>
                  <dd className="text-muted-foreground">
                    {previewState === "loading"
                      ? "Reading…"
                      : previewState === "failed" || !preview
                        ? "Couldn't read it just now"
                        : `${
                            preview.exportedAt
                              ? `saved ${formatTimestamp(preview.exportedAt)}`
                              : "save time unknown"
                          } · ${counts(preview.workoutCount, preview.setCount)}`}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="font-medium">This device</dt>
                  <dd className="text-muted-foreground">
                    {formatLastSynced(getSyncClock().lastSyncedAt).toLowerCase()}{" "}
                    · {counts(snapshot.workouts.length, snapshot.sets.length)}
                  </dd>
                </div>
              </dl>
            )}
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/5 bg-white/[.02] px-4 py-3">
          {done ? (
            <Button size="lg" onClick={closeDialog} autoFocus>
              Close
            </Button>
          ) : confirmOverwrite ? (
            <>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setConfirmOverwrite(false)}
                disabled={busy != null}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => void resolve("push")}
                disabled={busy != null}
              >
                {busy === "push" && <Loader2 className="size-4 animate-spin" />}
                Overwrite
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                onClick={closeDialog}
                disabled={busy != null}
                autoFocus
              >
                Later
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => setConfirmOverwrite(true)}
                disabled={busy != null}
              >
                Overwrite cloud
              </Button>
              <Button
                size="lg"
                onClick={() => void resolve("pull")}
                disabled={busy != null}
              >
                {busy === "pull" && <Loader2 className="size-4 animate-spin" />}
                Get cloud
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function counts(workouts: number, sets: number): string {
  return `${workouts.toLocaleString()} workouts, ${sets.toLocaleString()} sets`
}

function formatTimestamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}
