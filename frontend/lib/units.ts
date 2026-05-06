export type WeightUnit = "kg" | "lb"

export const KG_PER_LB = 0.45359237
export const LB_PER_KG = 1 / KG_PER_LB

/** Convert a stored kg value into the user's display unit. Null/undefined → 0. */
export function fromKg(kg: number | null | undefined, unit: WeightUnit): number {
  if (kg == null || !Number.isFinite(kg)) return 0
  return unit === "kg" ? kg : kg * LB_PER_KG
}

/** Convert a value entered by the user (in their display unit) to kg for storage. */
export function toKg(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) return 0
  return unit === "kg" ? value : value * KG_PER_LB
}

/** Round to a sensible precision for display: kg=1 decimal, lb=whole. */
export function roundForDisplay(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) return 0
  if (unit === "kg") return Math.round(value * 10) / 10
  return Math.round(value)
}

/** Display a stored kg value in the user's unit, rounded sensibly.
 *  Null (cardio rows with no weight) renders as "—". */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return "—"
  const v = roundForDisplay(fromKg(kg, unit), unit)
  return unit === "kg" ? v.toFixed(v % 1 === 0 ? 0 : 1) : v.toString()
}

/** Default +/- step for the unit. lb=5, kg=2.5. */
export function defaultStep(unit: WeightUnit): number {
  return unit === "kg" ? 2.5 : 5
}
