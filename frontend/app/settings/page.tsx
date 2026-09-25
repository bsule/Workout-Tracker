"use client"

import { useEffect, useState } from "react"
import {
  ArrowUpDown,
  Cloud,
  Dumbbell,
  MapPin,
  Palette,
  Pencil,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import {
  hasCloudConflict,
  loadSyncClock,
  subscribeSyncClock,
} from "@lift/core"
import { useAuth } from "@/components/auth/AuthProvider"
import { useConfirmLogout } from "@/components/auth/useConfirmLogout"
import { PopupModal, modalInputClass } from "@/components/settings/PopupModal"
import {
  EditableRow,
  NavRow,
  SettingsCard,
  SettingsGroup,
  SettingsHeading,
  SettingsPage,
} from "@/components/settings/SettingRows"
import { useSettings } from "@/components/settings/SettingsProvider"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { api as netApi, ApiError } from "@/lib/api"
import { localApi } from "@/lib/store"

type ProfileField = "username" | "email"

export default function SettingsHubPage() {
  const { user, refreshUser } = useAuth()
  const { settings } = useSettings()
  const confirmLogout = useConfirmLogout()

  // A refused push shows a dot on Backup & Restore, because the automatic
  // sync that hit it runs in the background and the choice lives there.
  const [cloudConflict, setCloudConflict] = useState(() => hasCloudConflict())
  useEffect(() => {
    void loadSyncClock().then(() => setCloudConflict(hasCloudConflict()))
    return subscribeSyncClock(() => setCloudConflict(hasCloudConflict()))
  }, [])

  const [editingField, setEditingField] = useState<ProfileField | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEditor(field: ProfileField) {
    setEditingField(field)
    setDraft(field === "username" ? user?.username ?? "" : user?.email ?? "")
    setError(null)
  }
  function closeEditor() {
    setEditingField(null)
    setError(null)
  }
  async function saveProfile() {
    if (!editingField) return
    const trimmed = draft.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await netApi.updateProfile(
        editingField === "username" ? { username: trimmed } : { email: trimmed }
      )
      await refreshUser()
      closeEditor()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save.")
    } finally {
      setBusy(false)
    }
  }

  const unit = settings.weight_unit
  const weekStart = settings.first_day_of_week === 1 ? "Monday" : "Sunday"
  const canSave = draft.trim().length > 0 && !busy

  return (
    <SettingsPage title="Settings" back={null}>
      <SettingsHeading>Account</SettingsHeading>
      <SettingsGroup>
        <EditableRow
          label="Username"
          value={user?.username ?? "-"}
          onEdit={() => openEditor("username")}
          icon={<Pencil className="size-3.5 text-muted-foreground" />}
        />
        <EditableRow
          label="Email"
          value={user?.email ?? "-"}
          onEdit={() => openEditor("email")}
          icon={<Pencil className="size-3.5 text-muted-foreground" />}
        />
      </SettingsGroup>

      <SettingsHeading>Preferences</SettingsHeading>
      <SettingsGroup inset>
        <NavRow
          icon={SlidersHorizontal}
          title="General"
          subtitle={`${unit} · Week starts ${weekStart}`}
          href="/settings/general"
        />
        <NavRow
          icon={Dumbbell}
          title="Set logger"
          subtitle="PRs, rest times, and timers in the set list"
          href="/settings/set-logger"
        />
      </SettingsGroup>

      <SettingsHeading>Categories</SettingsHeading>
      <SettingsGroup inset>
        <NavRow
          icon={Palette}
          title="Customize categories"
          subtitle="Names and colors"
          href="/settings/categories"
        />
      </SettingsGroup>

      <SettingsHeading>AI</SettingsHeading>
      <SettingsGroup inset>
        <NavRow
          icon={Sparkles}
          title="AI planning"
          subtitle="Provider and API keys"
          href="/settings/ai"
        />
      </SettingsGroup>

      <SettingsHeading>Data</SettingsHeading>
      <SettingsGroup inset>
        <NavRow
          icon={Cloud}
          title="Backup & Restore"
          subtitle="Cloud sync"
          // Cloud sync lives on this page, so an open conflict flags it.
          badge={cloudConflict}
          href="/settings/backup"
        />
        <NavRow
          icon={ArrowUpDown}
          title="Import / Export"
          subtitle="Lift JSON and FitNotes files"
          href="/import"
        />
      </SettingsGroup>

      <SettingsHeading>Gyms</SettingsHeading>
      <SettingsGroup inset>
        <NavRow
          icon={MapPin}
          title="Manage gyms"
          subtitle="Rename or remove saved gyms"
          href="/settings/gyms"
        />
      </SettingsGroup>

      <SettingsHeading>Maintenance</SettingsHeading>
      <MaintenanceCard />

      <div className="mt-6">
        <Button
          variant="destructive"
          size="lg"
          className="w-full"
          onClick={() => void confirmLogout()}
        >
          Log out
        </Button>
      </div>

      <PopupModal
        open={editingField != null}
        title={editingField === "email" ? "Edit email" : "Edit username"}
        onClose={closeEditor}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) void saveProfile()
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            type={editingField === "email" ? "email" : "text"}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={modalInputClass}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={closeEditor}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={!canSave}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopupModal>
    </SettingsPage>
  )
}

function MaintenanceCard() {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(
    null
  )

  async function recompute() {
    const ok = await confirm({
      title: "Recompute all PRs?",
      message:
        "This clears every PR mark (current and historical) and re-derives them from your set history.",
      confirmLabel: "Recompute",
    })
    if (!ok) return
    setBusy(true)
    setStatus(null)
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
    <SettingsCard>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Clears every PR mark and re-derives them from your set history. Useful
        if PRs got out of sync.
      </p>
      <Button variant="outline" size="lg" onClick={() => void recompute()} disabled={busy}>
        {busy ? "Recomputing…" : "Recompute PRs"}
      </Button>
      {status && (
        <p
          className={
            status.kind === "ok" ? "text-xs text-secondary" : "text-xs text-destructive"
          }
        >
          {status.msg}
        </p>
      )}
    </SettingsCard>
  )
}
