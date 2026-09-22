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

/** Round to a sensible precision for display: 1 decimal in either unit. */
export function roundForDisplay(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10) / 10
}

/** Display a stored kg value in the user's unit, rounded sensibly.
 *  Null (cardio rows with no weight) renders as "-". */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return "-"
  const v = roundForDisplay(fromKg(kg, unit), unit)
  return v.toFixed(v % 1 === 0 ? 0 : 1)
}

/** Default +/- step for the unit. lb=5, kg=2.5. */
export function defaultStep(unit: WeightUnit): number {
  return unit === "kg" ? 2.5 : 5
}

/**
 * Comparison key for a stored kg weight, quantized to 0.01 kg.
 *
 * Two sets that display the same weight can hold different kg floats. A weight
 * typed in lb converts to a long float (135 lb -> 61.23496995 kg), while the
 * FitNotes CSV kg column carries only two decimals (61.23) — and our own
 * .fitnotesdb export rounds the same way, so a round trip produces the mismatch
 * too. Comparing the raw floats let that noise outrank the reps tiebreak: the
 * imported row sorted above an equal one, and an older 135x7 stopped dominating
 * a newer 135x5, which then took the PR star.
 *
 * 0.01 kg is finer than any display step (0.1 lb is 0.045 kg) and far coarser
 * than the noise. The smallest real plate increment is 0.25 kg, so nothing
 * genuinely different collapses. Quantizing beats a tolerance compare because
 * it stays transitive, which the PR domination rule needs.
 *
 * Use it for every weight *comparison*. Keep the raw kg for display and export.
 */
export function weightKey(kg: number | null | undefined): number {
  if (kg == null || !Number.isFinite(kg)) return 0
  return Math.round(kg * 100)
}
