import { useEffect, useRef } from "react"
import { Alert } from "react-native"
import {
  autoSync,
  formatLastSynced,
  getState,
  getSyncClock,
  loadSyncClock,
  markCloudNewerPrompted,
  shouldPromptCloudNewer,
  subscribeSyncClock,
  type RemotePreview,
} from "@lift/core"
import { useAuth } from "../auth/AuthProvider"

/**
 * Tells the user, once, that a push was refused because the cloud moved ahead.
 *
 * Nothing was overwritten — the server rejects a stale push on its If-Match
 * precondition (cloudflare/src/sync/routes.ts). But the automatic 3-day sync
 * runs in the background, so without this the refusal would be invisible until
 * the user happened to open Import / Export.
 *
 * It asks once per distinct cloud version: markCloudNewerPrompted() fires when
 * the alert opens, not when it is answered, so dismissing it, ignoring it, or
 * force-quitting the app all count as told. An explicit "Sync now" can re-open
 * it through requestCloudNewerPrompt() — a button press must always answer.
 *
 * Renders nothing.
 */
export function CloudConflictPrompt() {
  const { user } = useAuth()
  const openRef = useRef(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function maybeShow() {
      if (cancelled || openRef.current) return
      if (!shouldPromptCloudNewer()) return
      openRef.current = true
      // Mark before showing: being asked is what counts, not answering.
      markCloudNewerPrompted()

      // Read the cloud copy first so the alert can say what is actually in it.
      // Pulls are unrestricted, so this costs no daily sync budget, and the
      // bytes are reused if the user takes the cloud copy. A failure here must
      // not swallow the alert — the user still has to be told.
      const preview = await autoSync.previewRemote().catch(() => null)
      if (cancelled) {
        openRef.current = false
        return
      }

      Alert.alert(
        "Cloud has newer data",
        buildMessage(preview),
        [
          { text: "Later", style: "cancel", onPress: () => { openRef.current = false } },
          { text: "Get cloud", onPress: () => void resolve("pull", preview) },
          {
            text: "Overwrite cloud",
            style: "destructive",
            onPress: () => confirmOverwrite(),
          },
        ],
        { cancelable: true, onDismiss: () => { openRef.current = false } }
      )
    }

    // This alert arrives unbidden, over whatever screen the user is on, so the
    // destructive choice gets a second step. The Sync screen's own button does
    // not need one — you go there on purpose.
    function confirmOverwrite() {
      Alert.alert(
        "Overwrite the cloud copy?",
        "The cloud's newer changes will be gone. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel", onPress: () => { openRef.current = false } },
          {
            text: "Overwrite",
            style: "destructive",
            onPress: () => void resolve("push", null),
          },
        ],
        { cancelable: true, onDismiss: () => { openRef.current = false } }
      )
    }

    async function resolve(
      choice: "pull" | "push",
      preview: RemotePreview | null
    ) {
      try {
        if (choice === "pull") {
          if (preview) {
            // Already downloaded above; don't fetch the same blob twice.
            await autoSync.applyRemoteBytes(preview.bytes)
            Alert.alert("Cloud copy loaded", "This device now matches the cloud.")
          } else {
            const applied = await autoSync.pullAndReplace()
            Alert.alert(
              applied ? "Cloud copy loaded" : "No cloud backup found",
              applied
                ? "This device now matches the cloud."
                : "Nothing to pull — the cloud is empty."
            )
          }
        } else {
          await autoSync.forcePush()
          Alert.alert("Cloud overwritten", "The cloud now matches this device.")
        }
      } catch (e) {
        Alert.alert(
          "Sync failed",
          e instanceof Error ? e.message : "Couldn't reach the server."
        )
      } finally {
        openRef.current = false
      }
    }

    // The conflict may already be on disk from a previous session.
    void loadSyncClock().then(maybeShow)
    const unsubscribe = subscribeSyncClock(() => void maybeShow())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [user])

  return null
}

/**
 * Both sides of the choice, so the user can judge which copy to keep. Falls
 * back to the bare explanation when the cloud copy could not be read — offline,
 * most likely, in which case neither choice can run anyway.
 */
function buildMessage(preview: RemotePreview | null): string {
  const intro =
    "Another device pushed changes this one hasn't seen, so the sync was refused. Nothing was lost."
  const local = getState().snapshot
  const here = `This device: ${formatLastSynced(
    getSyncClock().lastSyncedAt
  ).toLowerCase()} · ${counts(local.workouts.length, local.sets.length)}`

  if (!preview) {
    return `${intro}\n\n${here}\n\nCouldn't read the cloud copy just now. Get the cloud copy, or overwrite it with this device's data?`
  }
  const saved = preview.exportedAt
    ? `saved ${formatTimestamp(preview.exportedAt)}`
    : "save time unknown"
  const cloud = `Cloud copy: ${saved} · ${counts(
    preview.workoutCount,
    preview.setCount
  )}`
  return `${intro}\n\n${cloud}\n${here}\n\nGet the cloud copy, or overwrite it with this device's data?`
}

function counts(workouts: number, sets: number): string {
  return `${workouts.toLocaleString()} workouts, ${sets.toLocaleString()} sets`
}

function formatTimestamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}
