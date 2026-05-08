"use client"

import { createContext, useCallback, useContext } from "react"
import { localApi, useStore } from "@/lib/store"
import type { UserSettings } from "@/types"

const DEFAULTS: UserSettings = {
  weight_unit: "lb",
  first_day_of_week: 1,
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

/** Whether to show estimated 1RM under each set in the logger. Defaults
 *  to true when missing — this matches the on-by-default behavior the
 *  web shipped with before the toggle existed. */
export function useShowOneRm(): boolean {
  const v = useSettings().settings.show_one_rm
  return v == null ? true : v
}
