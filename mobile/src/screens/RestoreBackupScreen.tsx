import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { autoSync, type RemotePreview } from "@lift/core"
import { Button } from "../components/Button"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"
import { formatTimestamp } from "../format"
import { Card } from "../components/Card"

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
    <StaticSafeAreaView>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Restore from backup?</Text>
        <Text style={styles.help}>
          This device has no workouts yet. Pull your data down from cloud sync,
          or start fresh.
        </Text>

        <Card>
          <Text style={styles.rowTitle}>Sync from cloud</Text>
          <Text style={styles.help}>
            Pull the latest snapshot from your account on the Lift cloud.
          </Text>
          {cloudPreview ? (
            <>
              <View style={styles.previewBox}>
                <Text style={styles.help}>
                  Last saved{" "}
                  {cloudPreview.exportedAt
                    ? formatTimestamp(cloudPreview.exportedAt)
                    : "(unknown)"}
                </Text>
                <Text style={styles.help}>
                  {cloudPreview.workoutCount.toLocaleString()} workouts ·{" "}
                  {cloudPreview.setCount.toLocaleString()} sets ·{" "}
                  {cloudPreview.customExerciseCount.toLocaleString()} custom
                  exercises · {cloudPreview.gymCount.toLocaleString()} gyms
                </Text>
              </View>
              <View style={styles.actionsRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => setCloudPreview(null)}
                  disabled={busy != null}
                />
                <Button
                  label={busy === "cloud-apply" ? "Restoring…" : "Restore"}
                  style={{ flex: 1 }}
                  onPress={() => void applyCloudPreview()}
                  disabled={busy != null}
                />
              </View>
            </>
          ) : (
            <Button
              label={busy === "cloud-preview" ? "Loading…" : "Sync from cloud"}
              onPress={() => void loadCloudPreview()}
              disabled={busy != null}
            />
          )}
        </Card>

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
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: "700",
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
  previewBox: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
})
