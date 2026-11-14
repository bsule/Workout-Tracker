"use client"

import { useState } from "react"
import {
  SettingsFooter,
  SettingsGroup,
  SettingsHeading,
  SettingsPage,
  SwitchRow,
  ValueRow,
} from "@/components/settings/SettingRows"
import { PopupModal, modalInputClass } from "@/components/settings/PopupModal"
import {
  useRestTimerCutoffS,
  useRestTimerEnabled,
  useSettings,
} from "@/components/settings/SettingsProvider"
import { Button } from "@/components/ui/button"
import {
  CUTOFF_MAX_S,
  CUTOFF_MIN_S,
  formatCutoff,
  parseCutoff,
} from "@lift/core/restTimer"

export default function RestTimerSettingsPage() {
  const { update } = useSettings()
  const restTimerEnabled = useRestTimerEnabled()
  const restTimerCutoffS = useRestTimerCutoffS()

  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function openEditor() {
    setDraft(formatCutoff(restTimerCutoffS))
    setError(null)
    setEditorOpen(true)
  }

  async function setEnabled(on: boolean) {
    if (on === restTimerEnabled) return
    await update({ rest_timer_activity: on })
  }

  async function save() {
    const secs = parseCutoff(draft)
    if (secs == null) {
      setError("Enter minutes, like 6, or minutes and seconds, like 6:30.")
      return
    }
    if (secs < CUTOFF_MIN_S || secs > CUTOFF_MAX_S) {
      setError(`Enter a time from ${formatCutoff(CUTOFF_MIN_S)} to ${formatCutoff(CUTOFF_MAX_S)}.`)
      return
    }
    setBusy(true)
    try {
      if (secs !== restTimerCutoffS) {
        await update({ rest_timer_cutoff_s: secs })
      }
      setEditorOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage title="Rest timer">
      <SettingsHeading>Timer preferences</SettingsHeading>
      <SettingsGroup>
        <SwitchRow
          label="Rest timer outside the app"
          subtitle="Keep timer active when leaving the screen or tab"
          value={restTimerEnabled}
          onChange={(v) => void setEnabled(v)}
        />
        {restTimerEnabled && (
          <ValueRow
            label="Hide timer after"
            value={formatCutoff(restTimerCutoffS)}
            onPress={openEditor}
          />
        )}
      </SettingsGroup>
      <SettingsFooter>
        After each set, the time since that set counts your rest.
        {restTimerEnabled
          ? ` It automatically goes away after ${formatCutoff(restTimerCutoffS)}, when you are likely done.`
          : ""}
      </SettingsFooter>

      <PopupModal open={editorOpen} title="Hide timer after" onClose={() => setEditorOpen(false)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            autoFocus
            type="text"
            placeholder="6:00"
            className={modalInputClass}
          />
          <p className="text-xs text-muted-foreground">
            Minutes, or minutes and seconds. From {formatCutoff(CUTOFF_MIN_S)} to{" "}
            {formatCutoff(CUTOFF_MAX_S)}. Applies from your next set.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopupModal>
    </SettingsPage>
  )
}
