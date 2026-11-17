import { captureStoreSession, flushNow } from "../store/persist"
import { weightKey } from "../units"
import type { ImportResult } from "./fitnotesCsv"

/**
 * The import was applied to the in-memory store, but writing it to storage
 * failed. The data is live and the store retries the save on its own, so the
 * UI must not report "Import failed": the user would import again (and get
 * duplicates) or close the tab (and lose it, since bulk imports skip the
 * crash log).
 */
export class ImportNotSavedError extends Error {
  readonly result: ImportResult
  readonly saveError: unknown

  constructor(result: ImportResult, saveError: unknown) {
    const cause = saveError instanceof Error ? saveError.message : String(saveError)
    super(
      `The import is done, but it could not be saved yet (${cause}). Lift will keep trying. Keep this tab open until it saves.`
    )
    this.name = "ImportNotSavedError"
    this.result = result
    this.saveError = saveError
  }
}

/** Capture before an import applies anything; pass to saveImported. */
export function importSession(): () => void {
  return captureStoreSession()
}

/** Wait for the save after an applied import. A failed save while the same
 *  store is still loaded rejects with ImportNotSavedError (carrying the
 *  result): the data is in memory and the store retries. If the store was
 *  closed or switched meanwhile, the imported data is gone with it, so the
 *  raw error is a real failure. */
export async function saveImported(
  result: ImportResult,
  sameStore: () => void
): Promise<ImportResult> {
  try {
    await flushNow()
  } catch (e) {
    try {
      sameStore()
    } catch {
      throw e
    }
    throw new ImportNotSavedError(result, e)
  }
  return result
}

/** What makes two sets the same set when a file is merged in: weight (by
 *  weightKey, so float noise from another device or a lb conversion
 *  matches), reps, distance and time. */
export function setValueKey(s: {
  weight_kg?: number | null
  reps?: number | null
  distance_m?: number | null
  time_seconds?: number | null
}): string {
  const w = typeof s.weight_kg === "number" ? String(weightKey(s.weight_kg)) : "-"
  const n = (v: number | null | undefined) => (typeof v === "number" ? String(v) : "-")
  return `${w}|${n(s.reps)}|${n(s.distance_m)}|${n(s.time_seconds)}`
}
