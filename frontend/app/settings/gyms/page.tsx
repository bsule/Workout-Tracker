"use client"

import { useState } from "react"
import { Check, Pencil, Trash2, X } from "lucide-react"
import { gymAddError, gymRenameError } from "@lift/core/workouts"
import { SettingsCard, SettingsPage } from "@/components/settings/SettingRows"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { localApi as api, useStore } from "@/lib/store"
import type { Gym } from "@/types"

const inputClass =
  "h-10 min-w-0 flex-1 rounded-md border border-border bg-foreground/[.04] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"

const iconBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-foreground/[.06]"

export default function GymsPage() {
  const gyms = useStore((s) => s.snapshot.gyms) as Gym[]
  const confirm = useConfirm()
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [editError, setEditError] = useState<string | null>(null)

  function addGym() {
    const trimmed = draft.trim()
    if (!trimmed) return
    // "golds" when "Golds" is saved is the same gym, as on mobile.
    const problem = gymAddError(gyms, trimmed)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    try {
      api.createGym(trimmed).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to add gym.")
      })
      setDraft("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add gym.")
    }
  }

  function startEdit(g: Gym) {
    if (g.id == null) return
    setEditingId(g.id)
    setEditDraft(g.name)
    setEditError(null)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft("")
    setEditError(null)
  }
  function commitEdit() {
    if (editingId == null) return
    const problem = gymRenameError(gyms, editingId, editDraft)
    if (problem === "unchanged") {
      cancelEdit()
      return
    }
    if (problem) {
      setEditError(problem)
      return
    }
    void api.renameGym(editingId, editDraft.trim())
    cancelEdit()
  }

  async function removeGym(g: Gym) {
    if (g.id == null) return
    const ok = await confirm({
      title: "Remove gym?",
      message: `"${g.name}" will be removed from your saved gyms. Existing workouts that used this name will keep their gym text.`,
      destructive: true,
      confirmLabel: "Remove",
    })
    if (!ok) return
    if (editingId === g.id) cancelEdit()
    void api.deleteGym(g.id)
  }

  return (
    <SettingsPage title="Gyms">
      <SettingsCard>
        <form
          className="flex items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            addGym()
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a gym…"
            autoCorrect="off"
            className={inputClass}
          />
          <Button type="submit" size="lg" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </SettingsCard>

      {gyms.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No gyms yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {gyms.map((g, i) => {
            const isEditing = editingId != null && g.id === editingId
            return (
              <div
                key={g.id ?? g.name}
                className={i > 0 ? "border-t border-border" : undefined}
              >
                <div className="flex items-center gap-2 px-4 py-2.5">
                  {isEditing ? (
                    <input
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          commitEdit()
                        }
                        if (e.key === "Escape") cancelEdit()
                      }}
                      autoFocus
                      autoCorrect="off"
                      aria-label={`New name for ${g.name}`}
                      className={inputClass}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[15px]">{g.name}</span>
                  )}
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className={iconBtn}
                        aria-label="Cancel rename"
                      >
                        <X className="size-[18px] text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={commitEdit}
                        className={iconBtn}
                        aria-label="Save name"
                      >
                        <Check className="size-[18px] text-foreground" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(g)}
                        className={iconBtn}
                        aria-label={`Rename ${g.name}`}
                      >
                        <Pencil className="size-4 text-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeGym(g)}
                        className={iconBtn}
                        aria-label={`Remove ${g.name}`}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </button>
                    </>
                  )}
                </div>
                {isEditing && editError && (
                  <p className="px-4 pb-2.5 text-xs text-destructive">{editError}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SettingsPage>
  )
}
