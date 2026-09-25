// The display settings both clients read, with their defaults in one place.
// These are the mobile app's defaults: a key missing from an older snapshot
// reads the same on every device.

import type { UserSettings } from "./types"
import type { WeightUnit } from "./units"
import { restTimerSettings } from "./restTimer"

export interface DisplaySettings {
  weightUnit: WeightUnit
  firstDayOfWeek: 0 | 1
  /** Off unless the user turned it on. */
  showOneRm: boolean
  showPositionPrs: boolean
  showRestTime: boolean
  showTimeSinceLastSet: boolean
  showLastTime: boolean
  /** Rest timer outside the app (Live Activity / Android notification). */
  restTimerEnabled: boolean
  /** Seconds after the last set when that timer goes away. */
  restTimerCutoffS: number
}

export function readSettings(settings: UserSettings): DisplaySettings {
  const restTimer = restTimerSettings(settings)
  return {
    weightUnit: settings.weight_unit,
    firstDayOfWeek: settings.first_day_of_week,
    showOneRm: !!settings.show_one_rm,
    showPositionPrs: settings.show_position_prs ?? true,
    showRestTime: settings.show_rest_time ?? true,
    showTimeSinceLastSet: settings.show_time_since_last_set ?? true,
    showLastTime: settings.show_last_time ?? true,
    restTimerEnabled: restTimer.enabled,
    restTimerCutoffS: restTimer.cutoffS,
  }
}
