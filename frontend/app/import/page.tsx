"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload } from "lucide-react"
import { useAuth } from "@/components/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import { FullPageLoader } from "@/components/ui/Spinner"
import { cn } from "@/lib/utils"
import {
  importFitnotesCsv,
  previewCsv,
  type FitNotesPreview,
  type ImportMode,
  type ImportResult,
} from "@/lib/fitnotes/importCsv"

type Step = "upload" | "fitnotes" | "unknown" | "result"

export default function ImportPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<FitNotesPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [mode, setMode] = useState<ImportMode>("merge")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  async function uploadAndPreview(f: File) {
    setBusy(true)
    setError(null)
    try {
      const data = await previewCsv(f)
      setFile(f)
      setPreview(data)
      setStep(data.format === "fitnotes" ? "fitnotes" : "unknown")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read CSV")
    } finally {
      setBusy(false)
    }
  }

  async function runFitNotesImport() {
    if (!file) return
    if (mode === "replace") {
      const ok = window.confirm(
        "Replace everything?\n\nThis will permanently delete every workout, exercise, and set currently in the app, then load the CSV. Settings and gyms are kept.\n\nThis cannot be undone."
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await importFitnotesCsv(file, { mode })
      setResult(data)
      setStep("result")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    setStep("upload")
    setMode("merge")
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10 space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Import workouts</h1>
      <StepIndicator step={step} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {step === "upload" && (
        <UploadStep busy={busy} onFile={uploadAndPreview} />
      )}

      {step === "fitnotes" && preview && (
        <FitNotesConfirmStep
          rowCount={preview.rowCount}
          mode={mode}
          onModeChange={setMode}
          onBack={reset}
          onSubmit={runFitNotesImport}
          busy={busy}
        />
      )}

      {step === "unknown" && preview && (
        <UnknownFormatStep onBack={reset} />
      )}

      {step === "result" && result && <ResultStep result={result} onReset={reset} />}
    </div>
  )
}

function StepIndicator({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: "upload", label: "1. Upload" },
    {
      id: step === "unknown" ? "unknown" : "fitnotes",
      label: step === "unknown" ? "2. Unrecognized" : "2. Confirm",
    },
    { id: "result", label: "3. Result" },
  ]
  const i = items.findIndex((x) => x.id === step)
  return (
    <ol className="flex gap-2 text-xs">
      {items.map((x, idx) => (
        <li
          key={x.id}
          className={cn(
            "flex-1 rounded-md border px-3 py-2 text-center font-medium",
            idx === i
              ? "border-primary/40 bg-primary/10 text-primary"
              : idx < i
                ? "border-white/10 bg-white/[.02] text-foreground/70"
                : "border-white/10 bg-white/[.02] text-muted-foreground"
          )}
        >
          {x.label}
        </li>
      ))}
    </ol>
  )
}

function UploadStep({
  busy,
  onFile,
}: {
  busy: boolean
  onFile: (f: File) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload a FitNotes for Android CSV export. We&rsquo;ll detect the format
        automatically and import all 11 columns into your local data — distance,
        time, notes, exercise kind, everything. Imports run entirely in your
        browser; nothing is uploaded to a server.
      </p>
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-white/15 bg-white/[.02] p-12 text-sm hover:bg-white/[.04]",
          busy && "pointer-events-none opacity-60"
        )}
      >
        <Upload className="size-10 text-primary" />
        <span className="text-base font-semibold">
          {busy ? "Reading…" : "Click to choose a CSV file"}
        </span>
        <span className="text-xs text-muted-foreground">
          UTF-8 encoded · first row should contain column headers
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
          }}
        />
      </label>
    </div>
  )
}

function FitNotesConfirmStep({
  rowCount,
  mode,
  onModeChange,
  onBack,
  onSubmit,
  busy,
}: {
  rowCount: number
  mode: ImportMode
  onModeChange: (m: ImportMode) => void
  onBack: () => void
  onSubmit: () => void
  busy: boolean
}) {
  const submitLabel = busy
    ? mode === "replace"
      ? "Replacing…"
      : "Importing…"
    : mode === "replace"
      ? `Replace with ${rowCount.toLocaleString()} sets`
      : `Import ${rowCount.toLocaleString()} sets`

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="text-base font-semibold text-emerald-300">
          FitNotes export detected
        </div>
        <p className="mt-1 text-emerald-100/90">
          {rowCount.toLocaleString()} sets ready to import. Distance, time,
          notes, and exercise kind are preserved automatically — no column
          mapping needed.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Import mode
        </div>
        <ModeOption
          checked={mode === "merge"}
          onSelect={() => onModeChange("merge")}
          title="Add to my existing data"
          description="Keeps everything currently in the app. CSV sets are added; workouts on the same date and exercises with the same name are merged automatically."
          accent="emerald"
          disabled={busy}
        />
        <ModeOption
          checked={mode === "replace"}
          onSelect={() => onModeChange("replace")}
          title="Replace everything"
          description="Wipes all current workouts, exercises, sets, and PRs. The CSV becomes your only data. Settings and gyms are kept. This cannot be undone."
          accent="amber"
          disabled={busy}
        />
      </div>

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={busy}
          size="lg"
          variant={mode === "replace" ? "destructive" : "default"}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function ModeOption({
  checked,
  onSelect,
  title,
  description,
  accent,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  description: string
  accent: "emerald" | "amber"
  disabled: boolean
}) {
  const accentBorder =
    accent === "amber"
      ? "border-amber-500/50 bg-amber-500/10"
      : "border-emerald-500/40 bg-emerald-500/10"
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "w-full rounded-md border p-3 text-left text-sm transition",
        checked
          ? accentBorder
          : "border-white/10 bg-white/[.02] hover:bg-white/[.04]",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-block size-3.5 shrink-0 rounded-full border",
            checked
              ? "border-foreground bg-foreground"
              : "border-white/30 bg-transparent"
          )}
          aria-hidden
        />
        <div>
          <div className="font-semibold">{title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </button>
  )
}

function UnknownFormatStep({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <div className="text-base font-semibold text-amber-200">
          Format not recognized
        </div>
        <p className="mt-1 text-amber-100/80">
          Right now only the FitNotes Android CSV format is supported (header
          row should include <span className="font-mono">Date, Exercise,
          Category, Weight (kg), Weight (lbs), Reps, Distance, Distance Unit,
          Time, Notes, Kind</span>). If you&rsquo;re trying to import from a
          different app, let me know what columns it has.
        </p>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onBack}>
          Pick a different file
        </Button>
      </div>
    </div>
  )
}

function ResultStep({
  result,
  onReset,
}: {
  result: ImportResult
  onReset: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="text-base font-semibold text-emerald-300">
          {result.imported.toLocaleString()} sets imported
        </div>
        {result.exercisesCreated.length > 0 && (
          <div className="mt-2 text-emerald-200/90">
            Created {result.exercisesCreated.length} new custom exercise
            {result.exercisesCreated.length === 1 ? "" : "s"}:{" "}
            {result.exercisesCreated.join(", ")}
          </div>
        )}
      </div>

      {result.errors.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-200">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped
          </div>
          <ul className="mt-2 space-y-1 text-amber-100/90">
            {result.errors.slice(0, 50).map((e, i) => (
              <li key={i} className="font-mono text-xs">
                row {e.row}: {e.message}
              </li>
            ))}
            {result.errors.length > 50 && (
              <li className="text-xs italic text-amber-200/70">
                …and {result.errors.length - 50} more
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onReset}>
          Import another file
        </Button>
      </div>
    </div>
  )
}
