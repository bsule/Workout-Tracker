import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useStore } from "@lift/core"
import type { WeightUnit } from "@lift/core"
import { readSettings, type DisplaySettings } from "@lift/core/settings"

// The defaults live in @lift/core/settings so the web app reads the same.
type SettingsValue = DisplaySettings

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useStore((s) => s.snapshot.settings)
  const value = useMemo<SettingsValue>(
    () => readSettings(settings),
    [
      settings.weight_unit,
      settings.first_day_of_week,
      settings.show_one_rm,
      settings.show_position_prs,
      settings.show_rest_time,
      settings.show_time_since_last_set,
      settings.show_last_time,
      settings.rest_timer_activity,
      settings.rest_timer_cutoff_s,
    ]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSettings must be inside SettingsProvider")
  return v
}

export function useWeightUnit(): WeightUnit {
  return useSettings().weightUnit
}
