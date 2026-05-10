import { useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { importSnapshotJson } from "@lift/core/import"
import {
  loadBackupState,
  saveBackupState,
  type BackupState,
} from "../backup/backupState"
import { folderBridge } from "../backup/folderBridge"
import { runBackup } from "../backup/runner"
import { Button } from "../components/Button"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"

export function RestoreBackupScreen({ onDismiss }: { onDismiss: () => void }) {
  const [state, setState] = useState<BackupState | null>(null)
  const [busy, setBusy] = useState<null | "pick" | "restore">(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    void loadBackupState().then(setState)
  }, [])

  async function pickAndRestore() {
    setBusy("pick")
    setError(null)
    setInfo(null)
    try {
      const picked = await folderBridge.pickFolder()
      if (!picked) {
        setBusy(null)
        return
      }
      const next = await saveBackupState({
        bookmark: picked.bookmark,
        folderLabel: picked.label,
        lastBackupError: null,
      })
      setState(next)
      await restoreFrom(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't pick folder.")
      setBusy(null)
    }
  }

  async function restoreFrom(s: BackupState) {
    if (!s.bookmark) return
    setBusy("restore")
    setError(null)
    setInfo(null)
    try {
      const res = await folderBridge.readFile(s.bookmark, "lift-backup.json")
      if (!res.ok) {
        if (res.error === "not-found") {
          setError("No lift-backup.json in that folder. Pick a different folder or start fresh.")
        } else {
          setError(res.message)
        }
        return
      }
      await importSnapshotJson(res.contents, { mode: "replace" })
      // Round-trip: write the restored snapshot back so we know the folder works.
      void runBackup("manual")
      setInfo("Restored. Continuing…")
      onDismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed.")
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    )
  }

  return (
    <StaticSafeAreaView>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Restore from backup?</Text>
        <Text style={styles.help}>
          This device has no workouts yet. If you previously set up automatic
          backups in Files or iCloud Drive, you can pull that data back now.
        </Text>

        {state.bookmark && (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>{state.folderLabel ?? "Saved folder"}</Text>
            <Text style={styles.help}>
              Found a previously-saved backup folder. Restore from it?
            </Text>
            <View style={styles.actionsRow}>
              <Button
                label={busy === "restore" ? "Restoring…" : "Restore from this folder"}
                onPress={() => void restoreFrom(state)}
                disabled={busy != null}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.rowTitle}>
            {state.bookmark ? "Pick a different folder" : "Pick backup folder"}
          </Text>
          <Text style={styles.help}>
            Choose the folder where lift-backup.json was saved. iCloud Drive
            folders may take a moment to download.
          </Text>
          <Button
            label={busy === "pick" ? "Opening picker…" : "Pick folder"}
            variant="secondary"
            onPress={pickAndRestore}
            disabled={busy != null}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {info && <Text style={styles.info}>{info}</Text>}

        <Button
          label="Start fresh"
          variant="secondary"
          onPress={onDismiss}
          disabled={busy != null}
        />
      </ScrollView>
    </StaticSafeAreaView>
  )
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  center: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: "700",
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
  info: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
})
