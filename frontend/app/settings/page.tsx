"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  Check,
  Download,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/Dropdown"
import { useAuth } from "@/components/auth/AuthProvider"
import { useSettings } from "@/components/settings/SettingsProvider"
import { useTheme } from "@/components/settings/ThemeProvider"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { FullPageLoader, LoadingBlock } from "@/components/ui/Spinner"
import { api as netApi, ApiError } from "@/lib/api"
import { localApi, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { Gym } from "@/types"

export default function SettingsPage() {
  const { user, loading: authLoading, refreshUser } = useAuth()

  if (authLoading) {
    return <FullPageLoader />
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted-foreground">
          You need to <Link href="/login" className="text-primary underline">log in</Link> to access settings.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-display tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profile, display preferences, gyms, and your data.
        </p>
      </header>

      <AccountSection username={user.username} email={user.email} onSaved={refreshUser} />
      <DisplaySection />
      <GymsSection />
      <MaintenanceSection />
      <DataSection />
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-card/40 p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground/80">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-muted-foreground">
      {children}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-9 w-full rounded-md border border-white/10 bg-white/[.03] px-3 text-sm focus:outline-none focus:border-primary/50",
        className
      )}
    />
  )
}

function StatusLine({ kind, msg }: { kind: "ok" | "error" | "info"; msg: string }) {
  const color =
    kind === "ok" ? "text-emerald-400"
    : kind === "error" ? "text-destructive"
    : "text-muted-foreground"
  return <p className={cn("mt-2 text-xs", color)}>{msg}</p>
}

function AccountSection({
  username,
  email,
  onSaved,
}: {
  username: string
  email: string
  onSaved: () => Promise<void>
}) {
  const [u, setU] = useState(username)
  const [e, setE] = useState(email)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null)

  useEffect(() => { setU(username) }, [username])
  useEffect(() => { setE(email) }, [email])

  const dirty = u.trim() !== username || e.trim() !== email

  async function save() {
    setBusy(true); setStatus(null)
    try {
      const patch: Record<string, string> = {}
      if (u.trim() !== username) patch.username = u.trim()
      if (e.trim() !== email) patch.email = e.trim()
      await netApi.updateProfile(patch)
      await onSaved()
      setStatus({ kind: "ok", msg: "Saved." })
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof ApiError ? err.message : "Failed to save.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Account">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Username</FieldLabel>
          <TextInput value={u} onChange={setU} />
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <TextInput value={e} onChange={setE} type="email" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || busy} size="sm">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Save changes
        </Button>
        {status && <StatusLine kind={status.kind} msg={status.msg} />}
      </div>
    </Section>
  )
}

function DisplaySection() {
  const { settings, update } = useSettings()
  const { theme, toggle } = useTheme()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function changeUnit(v: string) {
    setBusy("unit"); setError(null)
    try {
      await update({ weight_unit: v as "kg" | "lb" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
    } finally { setBusy(null) }
  }

  async function changeDow(v: string) {
    setBusy("dow"); setError(null)
    try {
      await update({ first_day_of_week: Number(v) as 0 | 1 })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
    } finally { setBusy(null) }
  }

  async function changeOneRm(v: string) {
    setBusy("onerm"); setError(null)
    try {
      await update({ show_one_rm: v === "1" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
    } finally { setBusy(null) }
  }

  async function changePositionPrs(v: string) {
    setBusy("posprs"); setError(null)
    try {
      await update({ show_position_prs: v === "1" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
    } finally { setBusy(null) }
  }

  return (
    <Section title="Display" description="Affects how weights, the calendar, and colors look across the app.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <FieldLabel>Weight unit</FieldLabel>
          <Dropdown
            value={settings.weight_unit}
            onChange={changeUnit}
            options={[
              { value: "lb", label: "Pounds (lb)" },
              { value: "kg", label: "Kilograms (kg)" },
            ]}
          />
          {busy === "unit" && <p className="mt-1 text-xs text-muted-foreground">Saving…</p>}
        </div>
        <div>
          <FieldLabel>First day of week</FieldLabel>
          <Dropdown
            value={String(settings.first_day_of_week)}
            onChange={changeDow}
            options={[
              { value: "0", label: "Sunday" },
              { value: "1", label: "Monday" },
            ]}
          />
          {busy === "dow" && <p className="mt-1 text-xs text-muted-foreground">Saving…</p>}
        </div>
        <div>
          <FieldLabel>Theme</FieldLabel>
          <button
            onClick={toggle}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[.03] px-3 text-sm hover:bg-white/[.06]"
          >
            {theme === "dark" ? (
              <><Sun className="size-3.5" /> Switch to light</>
            ) : (
              <><Moon className="size-3.5" /> Switch to dark</>
            )}
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Defaults to dark.</p>
        </div>
        <div>
          <FieldLabel>Show 1RM</FieldLabel>
          <Dropdown
            value={(settings.show_one_rm ?? true) ? "1" : "0"}
            onChange={changeOneRm}
            options={[
              { value: "1", label: "Show under each set" },
              { value: "0", label: "Hide" },
            ]}
          />
          {busy === "onerm" && <p className="mt-1 text-xs text-muted-foreground">Saving…</p>}
        </div>
        <div>
          <FieldLabel>Per-set PRs</FieldLabel>
          <Dropdown
            value={(settings.show_position_prs ?? true) ? "1" : "0"}
            onChange={changePositionPrs}
            options={[
              { value: "1", label: "Show \"{n}PR\" badges" },
              { value: "0", label: "Overall PRs only" },
            ]}
          />
          {busy === "posprs" && <p className="mt-1 text-xs text-muted-foreground">Saving…</p>}
        </div>
      </div>
      {error && <StatusLine kind="error" msg={error} />}
    </Section>
  )
}

function GymsSection() {
  const confirm = useConfirm()
  const [gyms, setGyms] = useState<Gym[] | null>(null)
  const [draft, setDraft] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try { setGyms(await localApi.listGyms()) } catch { setGyms([]) }
  }
  useEffect(() => { load() }, [])

  async function add() {
    const name = draft.trim()
    if (!name) return
    setAdding(true); setError(null)
    try {
      await localApi.createGym(name)
      setDraft("")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add gym.")
    } finally {
      setAdding(false)
    }
  }

  async function remove(g: Gym) {
    if (g.id == null) return
    const ok = await confirm({
      title: "Remove gym?",
      message: `"${g.name}" will be removed from your saved gyms. Existing workouts that used this name will keep their gym text.`,
      destructive: true,
      confirmLabel: "Remove",
    })
    if (!ok) return
    try {
      await localApi.deleteGym(g.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove gym.")
    }
  }

  const saved = (gyms ?? []).filter((g) => g.id != null)
  const historical = (gyms ?? []).filter((g) => g.id == null)

  return (
    <Section
      title="Gyms"
      description="Manage your gym list. Saved gyms appear as suggestions when editing a workout."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder="New gym name"
          className="sm:flex-1"
        />
        <Button onClick={add} disabled={adding || !draft.trim()} size="sm">
          {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </Button>
      </div>
      {error && <StatusLine kind="error" msg={error} />}

      {gyms === null ? (
        <div className="mt-4"><LoadingBlock /></div>
      ) : saved.length === 0 && historical.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No gyms yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {saved.length > 0 && (
            <ul className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/10">
              {saved.map((g) => (
                <li key={g.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{g.name}</span>
                  <button
                    onClick={() => remove(g)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    aria-label="Delete gym"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {historical.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                From past workouts
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {historical.map((g) => (
                  <li
                    key={g.name}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 py-1 text-xs text-muted-foreground"
                  >
                    {g.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function MaintenanceSection() {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null)

  async function recompute() {
    const ok = await confirm({
      title: "Recompute all PRs?",
      message: "This clears every PR mark (current and historical) and re-derives them from your set history. Useful if PRs got out of sync.",
      confirmLabel: "Recompute",
    })
    if (!ok) return
    setBusy(true); setStatus(null)
    try {
      const res = await localApi.recomputePrs()
      setStatus({ kind: "ok", msg: `Recomputed PRs across ${res.recomputed} exercises.` })
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof Error ? e.message : "Failed." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Maintenance">
      <Button onClick={recompute} disabled={busy} size="sm">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Recompute PRs
      </Button>
      {status && <StatusLine kind={status.kind} msg={status.msg} />}
    </Section>
  )
}

function DataSection() {
  const [busy, setBusy] = useState<"csv" | "json" | "fitnotesdb" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()
  const snapshot = useStore((s) => s.snapshot)

  async function download(format: "csv" | "json" | "fitnotesdb") {
    setBusy(format); setError(null)
    try {
      if (format === "csv") {
        const { downloadCsv } = await import("@/lib/exports/snapshot")
        downloadCsv(snapshot)
      } else if (format === "json") {
        const { downloadJson } = await import("@/lib/exports/snapshot")
        downloadJson(snapshot, user?.username ?? "")
      } else {
        // sql.js is lazy-loaded only for this branch.
        const { downloadFitnotesDb } = await import("@/lib/fitnotes/exportDb")
        await downloadFitnotesDb(snapshot)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Data">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <DataCard
          title="Export"
          description="Download a complete copy of your workouts, sets, custom exercises, and saved gyms. Weights are in kilograms (canonical storage)."
          accent="primary"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => download("csv")}
              disabled={busy !== null}
              size="sm"
              variant="outline"
            >
              {busy === "csv" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              CSV
            </Button>
            <Button
              onClick={() => download("json")}
              disabled={busy !== null}
              size="sm"
              variant="outline"
            >
              {busy === "json" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              JSON
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/70">
            CSV: one row per set (date, exercise, weight, reps, PR flags, notes, gym).
            JSON: full nested workout structure plus your custom exercises and saved gyms.
          </p>
        </DataCard>

        <DataCard
          title="Export as FitNotes DB"
          description="A .fitnotesdb file you can side-load into FitNotes for iOS. Distance, time, notes, and exercise kind are all preserved."
          accent="primary"
        >
          <Button
            onClick={() => download("fitnotesdb")}
            disabled={busy !== null}
            size="sm"
            variant="outline"
          >
            {busy === "fitnotesdb" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            FitNotes DB
          </Button>
          <p className="mt-3 text-[11px] text-muted-foreground/70">
            Importable into FitNotes for iOS via the in-app restore flow.
          </p>
        </DataCard>

        <DataCard
          title="Import"
          description="Bring in workout history from a CSV. FitNotes Android exports are auto-detected — no column mapping needed."
          accent="emerald"
        >
          <Link
            href="/import"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <Upload className="size-3.5" />
            Import CSV
          </Link>
        </DataCard>
      </div>
      {error && <StatusLine kind="error" msg={error} />}
    </Section>
  )
}

function DataCard({
  title,
  description,
  accent,
  children,
}: {
  title: string
  description: string
  accent: "primary" | "emerald"
  children: React.ReactNode
}) {
  const accentBar =
    accent === "primary" ? "bg-primary" : "bg-emerald-400"
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[.02] p-4">
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-0.5",
          accentBar
        )}
      />
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
