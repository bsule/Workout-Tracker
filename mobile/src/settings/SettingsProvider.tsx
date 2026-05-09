import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useStore } from "@lift/core"
import type { WeightUnit } from "@lift/core"

interface SettingsValue {
  weightUnit: WeightUnit
  firstDayOfWeek: 0 | 1
  showOneRm: boolean
  showPositionPrs: boolean
}

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useStore((s) => s.snapshot.settings)
  const value = useMemo<SettingsValue>(
    () => ({
      weightUnit: settings.weight_unit,
      firstDayOfWeek: settings.first_day_of_week,
      showOneRm: !!settings.show_one_rm,
      showPositionPrs: settings.show_position_prs ?? true,
    }),
    [
      settings.weight_unit,
      settings.first_day_of_week,
      settings.show_one_rm,
      settings.show_position_prs,
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
