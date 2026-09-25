// The 1 Rep Max calculator's math, shared by the mobile screen and the web
// page. Weights come in and go out in the user's display unit; the estimate
// itself runs in kg (Brzycki, via estimateOneRm).

import { estimateOneRm } from "./store/materialize"
import { fromKg, roundForDisplay, toKg, type WeightUnit } from "./units"

/** The rows of the "% of 1RM" table, heaviest first. */
export const ONE_RM_PERCENTS = [95, 90, 85, 80, 75, 70, 65, 60]

/** Estimated 1RM in kg for `weight` (display unit) lifted for `reps`. */
export function oneRmKgFromDisplay(weight: number, reps: number, unit: WeightUnit): number {
  return estimateOneRm(toKg(weight, unit), reps)
}

/** The estimate in the display unit, rounded the way the screen shows it. */
export function oneRmDisplay(oneRmKg: number, unit: WeightUnit): number {
  return roundForDisplay(fromKg(oneRmKg, unit), unit)
}

/** `pct` percent of a display-unit 1RM, rounded for display. */
export function percentOfOneRm(oneRmDisplayValue: number, pct: number, unit: WeightUnit): number {
  return roundForDisplay((oneRmDisplayValue * pct) / 100, unit)
}
