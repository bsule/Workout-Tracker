import {
  importFitnotesCsv as coreImport,
  previewFitnotesCsv as corePreview,
  type FitNotesPreview,
  type ImportMode,
  type ImportResult,
} from "@lift/core/import"

export type { FitNotesPreview, ImportMode, ImportResult }

export async function previewCsv(file: File): Promise<FitNotesPreview> {
  return corePreview(await file.text())
}

export async function importFitnotesCsv(
  file: File,
  opts: { mode: ImportMode } = { mode: "merge" }
): Promise<ImportResult> {
  return coreImport(await file.text(), opts)
}
