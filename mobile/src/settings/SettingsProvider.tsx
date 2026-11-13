import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { WeightUnit, UserSettings } from "@lift/core"
import { readSettings, type DisplaySettings } from "@lift/core/settings"
import { EngineContext, queryValue, useSettingsQuery } from "@lift/engine-client/react"

// The defaults live in @lift/core/settings so the web app reads the same.
type SettingsValue = DisplaySettings

// A new account's settings (the engine's empty snapshot), for the signed-out
// screens. Signed in, StoreProvider reads the settings before the first frame.
const SIGNED_OUT_SETTINGS: UserSettings = {
  weight_unit: "lb",
  first_day_of_week: 0,
}

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const engine = useContext(EngineContext)
  if (engine) return <EngineSettingsProvider>{children}</EngineSettingsProvider>
  return <SignedOutSettingsProvider>{children}</SignedOutSettingsProvider>
}

function EngineSettingsProvider({ children }: { children: ReactNode }) {
  const state = useSettingsQuery()
  // Read before the first frame (openForUser), so the fallback never shows
  // for a signed-in account. A failed read goes to the error boundary rather
  // than swapping the weight unit under the user.
  const settings = queryValue(state, SIGNED_OUT_SETTINGS)
  const value = useMemo<SettingsValue>(
    () => readSettings(settings),
    [
      settings.weight_unit,
      settings.first_day_of_week,
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

function SignedOutSettingsProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => readSettings(SIGNED_OUT_SETTINGS), [])
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
