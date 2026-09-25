"use client"

import { createContext, useCallback, useContext } from "react"
import { localApi, useStore } from "@/lib/store"
import type { UserSettings } from "@/types"
import { readSettings } from "@lift/core/settings"

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
  const settings = useStore((s) => s.snapshot.settings) ?? DEFAULTS

  const update = useCallback(async (patch: Partial<UserSettings>) => {
    await localApi.updateSettings(patch)
  }, [])

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

/** Whether to show estimated 1RM under each set in the logger. Off unless
 *  the user turned it on. */
export function useShowOneRm(): boolean {
  return readSettings(useSettings().settings).showOneRm
}

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
