"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, Loader2, Sparkles, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { listExercisesQ } from "@/lib/store"
import type { Exercise } from "@lift/core"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import { Button } from "@/components/ui/button"
import { useSettings } from "@/components/settings/SettingsProvider"
import { AI_PROVIDERS, getProvider } from "@/lib/ai"
import { applyPlan } from "@/lib/ai/applyPlan"
import { buildHistoryContext } from "@/lib/ai/buildContext"
import { getApiKey } from "@/lib/ai/keys"
import { parseAiPlanResponse } from "@/lib/ai/parse"
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompts"
import type { AiPlanResponse } from "@/lib/ai/types"

function pad(n: number) {
  return String(n).padStart(2, "0")
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}
function todayString(): string {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
function addDays(date: string, days: number): string {
  const dt = new Date(date + "T00:00:00")
  dt.setDate(dt.getDate() + days)
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}
function enumerateDates(from: string, to: string): string[] {
  if (from > to) return []
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}
function niceDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
function formatSet(
  s: {
    weight?: number | null
    reps?: number | null
    distance_m?: number | null
    time_seconds?: number | null
  },
  unit: string,
): string {
  if (s.weight != null && s.reps != null) return `${s.weight}${unit}×${s.reps}`
  if (s.reps != null) return `×${s.reps}`
  if (s.distance_m != null && s.time_seconds != null)
    return `${s.distance_m}m / ${s.time_seconds}s`
  if (s.distance_m != null) return `${s.distance_m}m`
  if (s.time_seconds != null) return `${s.time_seconds}s`
  return "set"
}

export default function AiPlanPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const { settings } = useSettings()
  const snapshot = useStore((s) => s.snapshot)

  const incomingStart = searchParams.get("startDate")
  const tomorrow = addDays(todayString(), 1)
  const initialStart =
    incomingStart && incomingStart > todayString() ? incomingStart : tomorrow

  const [planStart, setPlanStart] = useState(initialStart)
  const [planEnd, setPlanEnd] = useState(addDays(initialStart, 2))
  const [useHistory, setUseHistory] = useState(true)
  const [historyStart, setHistoryStart] = useState(addDays(todayString(), -30))
  const [historyEnd, setHistoryEnd] = useState(todayString())
  const [selectedExercises, setSelectedExercises] = useState<Exercise[]>([])
  const [comment, setComment] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AiPlanResponse | null>(null)
  const [rawResponse, setRawResponse] = useState<string | null>(null)

  const providerId = settings.ai_provider ?? "openai"
  const providerLabel =
    AI_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId

  const planDates = useMemo(
    () => enumerateDates(planStart, planEnd),
    [planStart, planEnd],
  )
  const planDatesValid = planDates.length > 0 && planStart >= tomorrow
  const historyValid = !useHistory || historyStart <= historyEnd

  // Reactive exercise list, used by the picker.
  const allExercises = useMemo(
    () => listExercisesQ({ sort: "name" }),
    [snapshot],
  )

  async function onGenerate() {
    setError(null)
    setPreview(null)
    setRawResponse(null)

    if (!planDatesValid) {
      setError("Pick a plan-for range starting tomorrow or later.")
      return
    }
    if (!historyValid) {
      setError("History start must be before history end.")
      return
    }

    const apiKey = getApiKey(providerId)
    if (!apiKey) {
      setError(
        `No API key saved for ${providerLabel}. Add one in Settings → AI.`,
      )
      return
    }

    setBusy(true)
    try {
      const history = useHistory
        ? buildHistoryContext({
            from: historyStart,
            to: historyEnd,
            exerciseIds: selectedExercises.map((e) => e.id),
          })
        : []
      const exerciseLibrary = listExercisesQ({ sort: "last_performed" })
      const userPrompt = buildUserPrompt({
        planDates,
        weightUnit: settings.weight_unit,
        exerciseLibrary,
        history,
        historyDisabled: !useHistory,
        historyFiltered: selectedExercises.length > 0,
        comment,
      })
      const raw = await getProvider(providerId).generate({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        apiKey,
      })
      setRawResponse(raw)
      try {
        const parsed = parseAiPlanResponse(raw)
        setPreview(parsed)
      } catch (parseErr) {
        setError(
          parseErr instanceof Error
            ? parseErr.message
            : "Failed to parse AI response",
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onApply() {
    if (!preview) return
    setBusy(true)
    try {
      const res = await applyPlan(preview)
      if (res.errors.length > 0) {
        setError(
          `Applied ${res.appliedDates.length} day(s). Failed: ${res.errors
            .map((e) => `${e.date}: ${e.message}`)
            .join(" · ")}`,
        )
      } else {
        const firstDate = res.appliedDates[0]
        if (firstDate) {
          router.push(`/workouts/date/${firstDate}`)
        } else {
          router.push("/workouts")
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <FullPageLoader />
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted-foreground">
          You need to{" "}
          <Link href="/login" className="text-primary underline">
            log in
          </Link>{" "}
          to use AI planning.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10 space-y-6">
      <div className="space-y-3">
        <Link
          href="/calendar"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Calendar
        </Link>
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">AI Plan</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate planned workouts for future dates using your AI provider of
          choice. The plan respects your weight unit and exercise library.
        </p>
      </div>

      <Section title="Provider">
        <div>
          <p className="text-sm font-medium">{providerLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Change the provider or update API keys in{" "}
            <Link href="/settings" className="text-primary underline">
              Settings → AI
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section title="Plan for">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateField
            label="Start"
            value={planStart}
            min={tomorrow}
            onChange={(v) => {
              setPlanStart(v)
              if (v > planEnd) setPlanEnd(v)
            }}
          />
          <DateField
            label="End"
            value={planEnd}
            min={planStart}
            onChange={setPlanEnd}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {planDatesValid
            ? `${planDates.length} day${planDates.length === 1 ? "" : "s"} will be planned.`
            : "Pick future dates (tomorrow or later)."}
        </p>
      </Section>

      <Section title="History context">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Include past workouts</span>
          <input
            type="checkbox"
            checked={useHistory}
            onChange={(e) => setUseHistory(e.target.checked)}
            className="size-4 accent-primary"
          />
        </label>
        {useHistory && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DateField
                label="From"
                value={historyStart}
                onChange={(v) => {
                  setHistoryStart(v)
                  if (v > historyEnd) setHistoryEnd(v)
                }}
              />
              <DateField
                label="To"
                value={historyEnd}
                onChange={setHistoryEnd}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Limit to exercises
              </p>
              {selectedExercises.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  All exercises (no filter)
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedExercises.map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() =>
                        setSelectedExercises((cur) =>
                          cur.filter((e) => e.id !== ex.id),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-foreground/[.04] px-2.5 py-1 text-xs hover:bg-foreground/[.08]"
                    >
                      {ex.name}
                      <X className="size-3" />
                    </button>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                className="mt-2"
              >
                {selectedExercises.length > 0
                  ? "Edit exercises"
                  : "Pick exercises"}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Guidance (optional)">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="e.g. push/pull/legs split, focus on upper body, bad shoulder"
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-foreground/[.03] px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
        />
      </Section>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{error}</p>
          {rawResponse && (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
              {rawResponse}
            </pre>
          )}
        </div>
      )}

      {preview && (
        <Section title="Preview">
          {preview.days.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The AI returned no days.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {preview.days.map((d) => (
                <li key={d.date} className="py-2.5">
                  <p className="text-sm font-semibold">{niceDate(d.date)}</p>
                  {d.exercises.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Rest day</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {d.exercises.map((ex, i) => (
                        <li key={i} className="text-sm">
                          <span className="font-medium">{ex.name}</span>
                          {ex.sets.length > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              —{" "}
                              {ex.sets
                                .map((s) => formatSet(s, settings.weight_unit))
                                .join(", ")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <div className="flex gap-3">
        {preview ? (
          <>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setPreview(null)
                setRawResponse(null)
              }}
              disabled={busy}
            >
              Discard
            </Button>
            <Button className="flex-1" onClick={onApply} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Applying…" : "Apply"}
            </Button>
          </>
        ) : (
          <Button
            className="flex-1"
            onClick={onGenerate}
            disabled={busy || !planDatesValid || !historyValid}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "Generating…" : "Generate"}
          </Button>
        )}
      </div>

      {pickerOpen && (
        <ExercisePickerModal
          allExercises={allExercises}
          initialSelectedIds={selectedExercises.map((e) => e.id)}
          onClose={() => setPickerOpen(false)}
          onConfirm={(exs) => {
            setSelectedExercises(exs)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-foreground/[.03] p-5">
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function DateField({
  label,
  value,
  onChange,
  min,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  min?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-foreground/[.03] px-3 text-sm focus:outline-none focus:border-primary/50"
      />
    </div>
  )
}

function ExercisePickerModal({
  allExercises,
  initialSelectedIds,
  onClose,
  onConfirm,
}: {
  allExercises: Exercise[]
  initialSelectedIds: number[]
  onClose: () => void
  onConfirm: (exs: Exercise[]) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialSelectedIds),
  )
  const [query, setQuery] = useState("")

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allExercises
    return allExercises.filter((e) => e.name.toLowerCase().includes(q))
  }, [allExercises, query])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    const exs = allExercises.filter((e) => selected.has(e.id))
    onConfirm(exs)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Pick exercises</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="border-b border-border p-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-9 w-full rounded-md border border-border bg-foreground/[.03] px-3 text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-xs text-muted-foreground">
              No matches.
            </li>
          ) : (
            filtered.map((ex) => {
              const isSel = selected.has(ex.id)
              return (
                <li key={ex.id}>
                  <button
                    onClick={() => toggle(ex.id)}
                    className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-left text-sm hover:bg-foreground/[.04]"
                  >
                    <span>{ex.name}</span>
                    <span
                      className={
                        isSel
                          ? "size-4 rounded-sm border-2 border-primary bg-primary"
                          : "size-4 rounded-sm border-2 border-border"
                      }
                    />
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="flex gap-2 border-t border-border p-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button className="flex-1" onClick={confirm}>
            Done ({selected.size})
          </Button>
        </div>
      </div>
    </div>
  )
}
