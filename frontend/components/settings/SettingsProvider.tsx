"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { localApi, useStore } from "@/lib/store"
import type { UserSettings } from "@/types"
import { readSettings } from "@lift/core/settings"
import { EngineContext } from "@lift/engine-client/react"

const DEFAULTS: UserSettings = {
  weight_unit: "lb",
  first_day_of_week: 0,
}

interface SettingsState {
  settings: UserSettings
  update: (patch: Partial<UserSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const engineCtx = useContext(EngineContext)
  const storeSettings = useStore((s) => s.snapshot.settings) ?? DEFAULTS
  const [engineSettings, setEngineSettings] = useState<UserSettings | null>(null)

  useEffect(() => {
    if (!engineCtx) return
    let live = true
    const query = { kind: "settings" }
    const read = () => {
      const snap = engineCtx.client.snapshot<UserSettings>("settings", query)
      if (live && snap.status === "ready") setEngineSettings(snap.value)
    }
    const unsub = engineCtx.client.subscribe("settings", query, read)
    read()
    return () => {
      live = false
      unsub()
    }
  }, [engineCtx])

  const settings = (engineCtx && engineSettings) ? engineSettings : storeSettings

  const update = useCallback(async (patch: Partial<UserSettings>) => {
    if (engineCtx) {
      await engineCtx.api.updateSettings(patch)
    } else {
      await localApi.updateSettings(patch)
    }
  }, [engineCtx])

  return (
    <SettingsContext value={{ settings, update }}>
      {children}
    </SettingsContext>
  )
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}

/** Convenience: just the weight unit with a stable default. */
export function useWeightUnit() {
  return useSettings().settings.weight_unit
}

// The show_* defaults come from @lift/core/settings, the same reader the
// mobile app uses, so a synced snapshot shows the same things on both.

/** Whether to render per-set-position PR badges. Defaults to true. */
export function useShowPositionPrs(): boolean {
  return readSettings(useSettings().settings).showPositionPrs
}

/** Whether to render time-between-sets next to each set number on the
 *  log-set page. Defaults to true. */
export function useShowRestTime(): boolean {
  return readSettings(useSettings().settings).showRestTime
}

/** Whether to show a live ticking time-since-last-set timer on the
 *  log-set page. Defaults to true. */
export function useShowTimeSinceLastSet(): boolean {
  return readSettings(useSettings().settings).showTimeSinceLastSet
}

/** Whether to show the Last time / set position records card under
 *  the set list. Defaults to true. */
export function useShowLastTime(): boolean {
  return readSettings(useSettings().settings).showLastTime
}

/** Whether the rest timer outside the app / in background is enabled. */
export function useRestTimerEnabled(): boolean {
  return readSettings(useSettings().settings).restTimerEnabled
}

/** Seconds after the last set when that timer goes away. */
export function useRestTimerCutoffS(): number {
  return readSettings(useSettings().settings).restTimerCutoffS
}
