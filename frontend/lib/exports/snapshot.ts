/**
 * Web-side download helpers. The actual serialization lives in
 * `@lift/core/export` so mobile and web stay in sync; this file just adds the
 * DOM-only Blob/anchor download bits.
 */

import type { Snapshot } from "@/lib/store/schema"
import {
  buildCsv,
  buildJson,
  timestampedExportName,
} from "@lift/core/export"

export { buildCsv, buildJson }

export function downloadBlob(content: BlobPart, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadCsv(snap: Snapshot) {
  downloadBlob(
    buildCsv(snap),
    timestampedExportName("csv"),
    "text/csv;charset=utf-8"
  )
}

export function downloadJson(snap: Snapshot, username = "") {
  downloadBlob(
    buildJson(snap, username),
    timestampedExportName("json"),
    "application/json"
  )
}
