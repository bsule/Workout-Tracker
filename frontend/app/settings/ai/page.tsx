"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import type { AIProviderId } from "@lift/core"
import { AI_PROVIDERS } from "@/lib/ai"
import { clearApiKey, setApiKey, useSavedKeyIds } from "@/lib/ai/keys"
import { PopupModal, modalInputClass } from "@/components/settings/PopupModal"
import {
  SegmentRow,
  SettingsCard,
  SettingsFooter,
  SettingsGroup,
  SettingsHeading,
  SettingsPage,
} from "@/components/settings/SettingRows"
import { useSettings } from "@/components/settings/SettingsProvider"
import { Button } from "@/components/ui/button"

/**
 * Web only: pick an AI provider and keep its API key in this browser. Mobile
 * has the same controls in code but hides them for now.
 */
const PROVIDER_IDS: AIProviderId[] = AI_PROVIDERS.map((p) => p.id)

export default function AiSettingsPage() {
  const { settings, update } = useSettings()
  const activeProvider = (settings.ai_provider ?? "openai") as AIProviderId
  const savedKeyIds = useSavedKeyIds(PROVIDER_IDS)
  const keyPresence = useMemo(() => {
    const saved = new Set(savedKeyIds.split(","))
    return Object.fromEntries(PROVIDER_IDS.map((id) => [id, saved.has(id)])) as Record<
      AIProviderId,
      boolean
    >
  }, [savedKeyIds])
  const [editing, setEditing] = useState<AIProviderId | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  function openEditor(id: AIProviderId) {
    setEditing(id)
    setDraft("")
    setError(null)
  }
  function closeEditor() {
    setEditing(null)
    setError(null)
  }
  function saveKey() {
    if (!editing) return
    const v = draft.trim()
    if (!v) return
    try {
      setApiKey(editing, v)
      closeEditor()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save key.")
    }
  }
  function deleteKey(id: AIProviderId) {
    clearApiKey(id)
  }

  const editingLabel = AI_PROVIDERS.find((p) => p.id === editing)?.label ?? ""

  return (
    <SettingsPage title="AI planning">
      <SettingsHeading>Provider</SettingsHeading>
      <SettingsGroup>
        <SegmentRow
          label="Active provider"
          options={AI_PROVIDERS.map((p) => ({
            label: p.label,
            active: activeProvider === p.id,
            onSelect: () => void update({ ai_provider: p.id }),
          }))}
        />
      </SettingsGroup>

      <SettingsHeading>API keys</SettingsHeading>
      <SettingsGroup>
        {AI_PROVIDERS.map((p) => {
          const has = keyPresence[p.id]
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground">
                  {has ? "Key saved" : "No key set"}
                </p>
              </div>
              <Button variant="outline" onClick={() => openEditor(p.id)}>
                {has ? "Update" : "Set"}
              </Button>
              {has && (
                <Button variant="destructive" onClick={() => deleteKey(p.id)}>
                  Clear
                </Button>
              )}
            </div>
          )
        })}
      </SettingsGroup>
      <SettingsFooter>
        Keys are stored in this browser only. Anyone with access to this
        device or the browser&apos;s dev tools can read them.
      </SettingsFooter>

      <SettingsCard>
        <Link
          href="/ai-plan"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
        >
          <Sparkles className="size-4" />
          Open AI Plan
        </Link>
      </SettingsCard>

      <PopupModal
        open={editing != null}
        title={`${editingLabel} API key`}
        onClose={closeEditor}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            saveKey()
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your API key"
            autoFocus
            autoComplete="off"
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
            <Button type="submit" size="lg" className="flex-1" disabled={!draft.trim()}>
              Save
            </Button>
          </div>
        </form>
      </PopupModal>
    </SettingsPage>
  )
}
