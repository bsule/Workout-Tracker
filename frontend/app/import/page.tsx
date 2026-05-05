"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/components/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import { CATEGORIES, type Category } from "@/types"
import type {
  CsvImportResponse,
  CsvMapping,
  CsvPreviewResponse,
} from "@/types"
import { CATEGORY_LABELS, cn } from "@/lib/utils"

type Step = "upload" | "mapping" | "result"

const DATE_FORMAT_OPTIONS = [
  { value: "%Y-%m-%d", label: "YYYY-MM-DD (2026-05-04)" },
  { value: "%Y/%m/%d", label: "YYYY/MM/DD (2026/05/04)" },
  { value: "%m/%d/%Y", label: "MM/DD/YYYY (05/04/2026)" },
  { value: "%d/%m/%Y", label: "DD/MM/YYYY (04/05/2026)" },
  { value: "%m-%d-%Y", label: "MM-DD-YYYY (05-04-2026)" },
  { value: "%d-%m-%Y", label: "DD-MM-YYYY (04-05-2026)" },
  { value: "%Y-%m-%d %H:%M:%S", label: "YYYY-MM-DD HH:MM:SS" },
  { value: "%m/%d/%Y %H:%M", label: "MM/DD/YYYY HH:MM" },
]

export default function ImportPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mapping, setMapping] = useState<CsvMapping>({
    date_col: "",
    exercise_col: "",
    weight_col: "",
    reps_col: "",
    category_col: "",
    default_category: "chest",
    date_format: "%Y-%m-%d",
  })
  const [result, setResult] = useState<CsvImportResponse | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  async function uploadAndPreview(f: File) {
    setBusy(true)
    setError(null)
    try {
      const data = await api.csvPreview(f)
      setFile(f)
      setPreview(data)
      // Best-effort auto-fill mapping from headers.
      const guess = guessMapping(data.headers)
      setMapping((prev) => ({
        ...prev,
        ...guess,
        date_format: data.inferred_date_format ?? prev.date_format,
      }))
      setStep("mapping")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read CSV")
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const data = await api.csvImport(file, mapping)
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
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10 space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Import CSV</h1>
      <StepIndicator step={step} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {step === "upload" && (
        <UploadStep busy={busy} onFile={uploadAndPreview} />
      )}

      {step === "mapping" && preview && (
        <MappingStep
          preview={preview}
          mapping={mapping}
          onChange={setMapping}
          onBack={reset}
          onSubmit={runImport}
          busy={busy}
        />
      )}

      {step === "result" && result && <ResultStep result={result} onReset={reset} />}
    </div>
  )
}

function guessMapping(headers: string[]): Partial<CsvMapping> {
  const find = (...needles: string[]) =>
    headers.find((h) =>
      needles.some((n) => h.toLowerCase().includes(n))
    ) ?? ""
  return {
    date_col: find("date"),
    exercise_col: find("exercise", "lift", "movement"),
    weight_col: find("weight", "lb", "kg"),
    reps_col: find("reps", "rep"),
    category_col: find("category", "muscle", "group"),
  }
}

function StepIndicator({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: "upload", label: "1. Upload" },
    { id: "mapping", label: "2. Map columns" },
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
        Upload a CSV file with your workout history. You can map the columns in
        the next step. We never persist the upload — each run reads the file
        fresh.
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
          UTF-8 encoded; first row should contain column headers
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

function MappingStep({
  preview,
  mapping,
  onChange,
  onBack,
  onSubmit,
  busy,
}: {
  preview: CsvPreviewResponse
  mapping: CsvMapping
  onChange: (m: CsvMapping) => void
  onBack: () => void
  onSubmit: () => void
  busy: boolean
}) {
  const ready =
    mapping.date_col &&
    mapping.exercise_col &&
    mapping.weight_col &&
    mapping.reps_col

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">
          Sample rows ({preview.row_count} total)
        </h2>
        <div className="mt-2 overflow-x-auto rounded-md border border-white/10">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="bg-white/[.03] text-muted-foreground">
              <tr>
                {preview.headers.map((h) => (
                  <th
                    key={h}
                    className="px-2 py-1.5 text-left font-medium tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i} className="border-t border-white/5">
                  {preview.headers.map((h) => (
                    <td key={h} className="px-2 py-1.5 tabular-nums">
                      {r[h] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColumnSelect
          label="Date column"
          headers={preview.headers}
          value={mapping.date_col}
          onChange={(v) => onChange({ ...mapping, date_col: v })}
        />
        <ColumnSelect
          label="Exercise name column"
          headers={preview.headers}
          value={mapping.exercise_col}
          onChange={(v) => onChange({ ...mapping, exercise_col: v })}
        />
        <ColumnSelect
          label="Weight column"
          headers={preview.headers}
          value={mapping.weight_col}
          onChange={(v) => onChange({ ...mapping, weight_col: v })}
        />
        <ColumnSelect
          label="Reps column"
          headers={preview.headers}
          value={mapping.reps_col}
          onChange={(v) => onChange({ ...mapping, reps_col: v })}
        />
        <ColumnSelect
          label="Category column (optional)"
          headers={preview.headers}
          value={mapping.category_col ?? ""}
          allowEmpty
          onChange={(v) => onChange({ ...mapping, category_col: v })}
        />
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Default category for new exercises
          </label>
          <select
            value={mapping.default_category ?? "chest"}
            onChange={(e) =>
              onChange({
                ...mapping,
                default_category: e.target.value as Category,
              })
            }
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Date format
          </label>
          <select
            value={mapping.date_format ?? "%Y-%m-%d"}
            onChange={(e) =>
              onChange({ ...mapping, date_format: e.target.value })
            }
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm"
          >
            {DATE_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={!ready || busy} size="lg">
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>
    </div>
  )
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  allowEmpty,
}: {
  label: string
  headers: string[]
  value: string
  onChange: (v: string) => void
  allowEmpty?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm"
      >
        {allowEmpty && <option value="">(none)</option>}
        {!value && !allowEmpty && <option value="">— select —</option>}
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  )
}

function ResultStep({
  result,
  onReset,
}: {
  result: CsvImportResponse
  onReset: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="text-base font-semibold text-emerald-300">
          {result.imported} sets imported
        </div>
        {result.exercises_created.length > 0 && (
          <div className="mt-2 text-emerald-200/90">
            Created {result.exercises_created.length} new custom exercise
            {result.exercises_created.length === 1 ? "" : "s"}:{" "}
            {result.exercises_created.join(", ")}
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
