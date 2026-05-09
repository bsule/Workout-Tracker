import {
  importFitnotesCsv as coreImportCsv,
  previewFitnotesCsv as corePreviewCsv,
  importSnapshotJson as coreImportJson,
  previewSnapshotJson as corePreviewJson,
  type FitNotesPreview,
  type SnapshotJsonPreview,
  type ImportMode,
  type ImportResult,
} from "@lift/core/import"

export type {
  FitNotesPreview,
  SnapshotJsonPreview,
  ImportMode,
  ImportResult,
}

export type Preview =
  | ({ kind: "fitnotes" } & FitNotesPreview)
  | ({ kind: "snapshot" } & SnapshotJsonPreview)
  | { kind: "unknown"; reason: string }

function looksLikeJson(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 0xfeff) continue
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) continue
    return text[i] === "{" || text[i] === "["
  }
  return false
}

export async function previewFile(file: File): Promise<Preview> {
  const text = await file.text()
  if (looksLikeJson(text)) {
    const p = corePreviewJson(text)
    if (p.format === "lift-snapshot") return { kind: "snapshot", ...p }
    return {
      kind: "unknown",
      reason: p.reason ?? "JSON file is not a Lift snapshot.",
    }
  }
  const p = corePreviewCsv(text)
  if (p.format === "fitnotes") return { kind: "fitnotes", ...p }
  return {
    kind: "unknown",
    reason: "CSV header didn't match the FitNotes format.",
  }
}

// Back-compat alias used by the old import page step.
export async function previewCsv(file: File): Promise<FitNotesPreview> {
  const text = await file.text()
  return corePreviewCsv(text)
}

export async function importFitnotesCsv(
  file: File,
  opts: { mode: ImportMode } = { mode: "merge" }
): Promise<ImportResult> {
  return coreImportCsv(await file.text(), opts)
}

export async function importSnapshotJson(
  file: File,
  opts: { mode: ImportMode } = { mode: "merge" }
): Promise<ImportResult> {
  return coreImportJson(await file.text(), opts)
}
