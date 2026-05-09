import { useState } from "react"
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
import { useStore } from "@lift/core"
import {
  buildCsv,
  buildJson,
  timestampedExportName,
} from "@lift/core/export"
import {
  importFitnotesCsv,
  importSnapshotJson,
  previewFitnotesCsv,
  previewSnapshotJson,
  type ImportMode,
  type ImportResult,
} from "@lift/core/import"
import { useAuth } from "../auth/AuthProvider"
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

  const [busy, setBusy] = useState<null | "json" | "csv" | "pick" | "import">(null)
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

  async function exportCsv() {
    setBusy("csv")
    setError(null)
    try {
      const filename = timestampedExportName("csv")
      const body = buildCsv(snapshot)
      await shareFile(filename, body, "text/csv")
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
          Back up your workouts, share them as a spreadsheet, or restore from a
          previous backup. Everything happens on this device, no data is sent
          to a server.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

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
            <Text style={styles.rowTitle}>FitNotes-compatible CSV</Text>
            <Text style={styles.help}>
              One row per set. Good for spreadsheets or moving data into FitNotes.
            </Text>
          </View>
          <Button
            label={busy === "csv" ? "Preparing…" : "Export CSV"}
            onPress={exportCsv}
            variant="secondary"
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
                variant="secondary"
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
            <Button label="Done" variant="secondary" onPress={clearResult} />
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
})
