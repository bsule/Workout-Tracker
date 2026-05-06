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
    setBusy(true)
    setError(null)
    try {
      const data = await importFitnotesCsv(file)
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
  onBack,
  onSubmit,
  busy,
}: {
  rowCount: number
  onBack: () => void
  onSubmit: () => void
  busy: boolean
}) {
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
      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={busy} size="lg">
          {busy ? "Importing…" : `Import ${rowCount.toLocaleString()} sets`}
        </Button>
      </div>
    </div>
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
