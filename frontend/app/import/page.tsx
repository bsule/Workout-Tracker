"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  importFitnotesCsv,
  importSnapshotJson,
  previewFitnotesCsv,
  looksLikeJson,
  previewSnapshotJson,
  type ImportMode,
  type ImportResult,
} from "@lift/core/import"
import { formatTimestamp } from "@lift/core/format"
import { useAuth } from "@/components/auth/AuthProvider"
import {
  SettingsCard,
  SettingsHeading,
  SettingsPage,
} from "@/components/settings/SettingRows"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

type PendingImport =
  | {
      kind: "snapshot"
      text: string
      workoutCount: number
      setCount: number
      customExerciseCount: number
      gymCount: number
      exportedAt: string | null
    }
  | { kind: "fitnotes"; text: string; rowCount: number }

/** Import / Export, the web copy of mobile's ImportExportScreen. */
export default function ImportExportPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  if (loading || !user) return <FullPageLoader />
  return <ImportExport username={user.username} />
}

function ImportExport({ username }: { username: string }) {
  const confirm = useConfirm()
  const snapshot = useStore((s) => s.snapshot)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [busy, setBusy] = useState<
    null | "json" | "csv" | "fitnotesdb" | "pick" | "import"
  >(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [mode, setMode] = useState<ImportMode>("merge")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runExport(kind: "json" | "csv" | "fitnotesdb") {
    setBusy(kind)
    setError(null)
    try {
      if (kind === "json") {
        const { downloadJson } = await import("@/lib/exports/snapshot")
        downloadJson(snapshot, username)
      } else if (kind === "csv") {
        const { downloadCsv } = await import("@/lib/exports/snapshot")
        downloadCsv(snapshot)
      } else {
        // sql.js is lazy-loaded only for this branch.
        const { downloadFitnotesDb } = await import("@/lib/fitnotes/exportDb")
        await downloadFitnotesDb(snapshot)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setBusy(null)
    }
  }

  async function readAndPreview(file: File) {
    setBusy("pick")
    setError(null)
    setResult(null)
    try {
      const text = await file.text()
      if (looksLikeJson(text)) {
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
        setPending({ kind: "fitnotes", text, rowCount: p.rowCount })
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
      const ok = await confirm({
        title: "Replace everything?",
        message:
          "This permanently deletes every workout, exercise, and set currently in the app, then loads the file. Settings are kept. This cannot be undone.",
        confirmLabel: "Replace",
        destructive: true,
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

  const exportDisabled = busy != null
  const importDisabled = busy != null && busy !== "import"

  return (
    <SettingsPage title="Import / Export">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Save your workouts to a file, or bring them in from a Lift or FitNotes
        export. Cloud sync is under{" "}
        <Link href="/settings/backup" className="text-primary hover:underline">
          Backup &amp; Restore
        </Link>
        .
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <SettingsHeading>Export</SettingsHeading>
      <ExportCard
        title="Lift JSON backup"
        help="Full snapshot: workouts, custom exercises, saved gyms. Re-importable on Lift mobile or web."
        label={busy === "json" ? "Preparing…" : "Export JSON"}
        onPress={() => void runExport("json")}
        disabled={exportDisabled}
      />
      <ExportCard
        title="FitNotes-compatible DB"
        help="A .fitnotesdb file you can side-load into FitNotes for iOS. Distance, time, notes, and exercise kind are all preserved."
        label={busy === "fitnotesdb" ? "Preparing…" : "Export FitNotes DB"}
        onPress={() => void runExport("fitnotesdb")}
        disabled={exportDisabled}
      />
      <ExportCard
        title="CSV spreadsheet"
        help="One row per set: date, exercise, weight, reps, PR flags, notes, gym. For spreadsheets; Lift can't import it back."
        label={busy === "csv" ? "Preparing…" : "Export CSV"}
        onPress={() => void runExport("csv")}
        disabled={exportDisabled}
      />

      <SettingsHeading>Import</SettingsHeading>
      <SettingsCard>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pick a Lift JSON backup or a FitNotes Android CSV export. The format
          is detected automatically.
        </p>
        <Button
          size="lg"
          onClick={() => fileRef.current?.click()}
          disabled={importDisabled}
        >
          {busy === "pick" ? "Reading…" : "Choose file"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Clear it so picking the same file again still fires.
            e.target.value = ""
            if (f) void readAndPreview(f)
          }}
        />
      </SettingsCard>

      {pending && (
        <SettingsCard>
          <p className="text-[15px] font-semibold">
            {pending.kind === "snapshot"
              ? "Lift backup detected"
              : "FitNotes export detected"}
          </p>
          {pending.kind === "snapshot" ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {pending.workoutCount.toLocaleString()} workouts ·{" "}
              {pending.setCount.toLocaleString()} sets ·{" "}
              {pending.customExerciseCount.toLocaleString()} custom exercises ·{" "}
              {pending.gymCount.toLocaleString()} gyms
              {pending.exportedAt
                ? ` · exported ${formatTimestamp(pending.exportedAt)}`
                : ""}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {pending.rowCount.toLocaleString()} sets ready to import.
            </p>
          )}

          <div className="flex flex-col gap-2">
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
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => setPending(null)}
              disabled={busy === "import"}
            >
              Cancel
            </Button>
            <Button
              variant={mode === "replace" ? "destructive" : "default"}
              size="lg"
              className="flex-1"
              onClick={() => void runImport()}
              disabled={busy === "import"}
            >
              {busy === "import"
                ? mode === "replace"
                  ? "Replacing…"
                  : "Importing…"
                : mode === "replace"
                  ? "Replace"
                  : "Import"}
            </Button>
          </div>
        </SettingsCard>
      )}

      {result && (
        <SettingsCard>
          <p className="text-[15px] font-semibold">
            {result.imported.toLocaleString()} sets imported
          </p>
          {result.exercisesCreated.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Created {result.exercisesCreated.length} new custom exercise
              {result.exercisesCreated.length === 1 ? "" : "s"}:{" "}
              {result.exercisesCreated.join(", ")}
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {result.errors.length} row
              {result.errors.length === 1 ? "" : "s"} skipped. First few:{" "}
              {result.errors
                .slice(0, 3)
                .map((e) => `row ${e.row}: ${e.message}`)
                .join(" · ")}
            </p>
          )}
          <Button size="lg" onClick={() => setResult(null)}>
            Done
          </Button>
        </SettingsCard>
      )}

      {busy === "import" && <LoadingBlock />}
    </SettingsPage>
  )
}

function ExportCard({
  title,
  help,
  label,
  onPress,
  disabled,
}: {
  title: string
  help: string
  label: string
  onPress: () => void
  disabled: boolean
}) {
  return (
    <SettingsCard>
      <div className="flex flex-col gap-2">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
      </div>
      <Button size="lg" onClick={onPress} disabled={disabled}>
        {label}
      </Button>
    </SettingsCard>
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
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-opacity",
        checked
          ? destructive
            ? "border-destructive"
            : "border-foreground"
          : "border-border hover:bg-foreground/[.03]",
        disabled && "opacity-60"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[3px] size-3.5 shrink-0 rounded-full border",
          checked
            ? destructive
              ? "border-destructive bg-destructive"
              : "border-foreground bg-foreground"
            : "border-border"
        )}
      />
      <span className="flex-1">
        <span className="mb-0.5 block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}
