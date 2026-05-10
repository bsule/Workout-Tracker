/**
 * Web wrapper around @lift/core's buildFitnotesDb. Lazily loads sql.js so the
 * ~700KB WASM only enters the bundle when the user clicks "Export as
 * FitNotes DB", keeping daily-driver app speed unaffected.
 */

import {
  buildFitnotesDb,
  timestampedFitnotesDbName,
  type SqlJsModule,
} from "@lift/core/export"
import type { Snapshot } from "@/lib/store/schema"

const SKELETON_URL = "/data/fitnotes_skeleton.fitnotesdb"

/** Trigger a download of the .fitnotesdb file in the browser. */
export async function downloadFitnotesDb(snap: Snapshot): Promise<void> {
  const { default: initSqlJs } = await import("sql.js")
  const SQL = await initSqlJs({
    locateFile: (file: string) => `/data/${file}`,
  })

  const skelResp = await fetch(SKELETON_URL)
  if (!skelResp.ok) {
    throw new Error(
      `Failed to load FitNotes skeleton from ${SKELETON_URL} (HTTP ${skelResp.status})`
    )
  }
  const skeletonBytes = new Uint8Array(await skelResp.arrayBuffer())

  const bytes = await buildFitnotesDb(snap, {
    skeletonBytes,
    SQL: SQL as unknown as SqlJsModule,
  })
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" })
  const filename = timestampedFitnotesDbName()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
