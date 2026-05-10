import { getState } from "@lift/core"
import { buildJson } from "@lift/core/export"
import { folderBridge, isBackupFolderAvailable } from "./folderBridge"
import { loadBackupState, saveBackupState } from "./backupState"

export type BackupOutcome = "ok" | "not-configured" | "error"

const DEBOUNCE_MS = 4000

let getUsername: () => string = () => ""
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let pendingReason: "open" | "write" | "manual" | null = null

export function configureBackupRunner(opts: { getUsername: () => string }) {
  getUsername = opts.getUsername
}

export function scheduleDebouncedBackup() {
  if (!isBackupFolderAvailable()) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runBackup("write")
  }, DEBOUNCE_MS)
}

export async function runBackup(
  reason: "open" | "write" | "manual"
): Promise<BackupOutcome> {
  if (!isBackupFolderAvailable()) return "not-configured"
  if (inFlight) {
    // Coalesce: remember that another trigger fired. After the current run
    // finishes we'll re-check if anything has changed since.
    pendingReason = reason
    return "ok"
  }
  inFlight = true
  try {
    const state = await loadBackupState()
    if (!state.bookmark) return "not-configured"

    const { snapshot, hydrated } = getState()
    if (!hydrated) return "not-configured"

    const json = buildJson(snapshot, getUsername())
    const res = await folderBridge.writeFile(state.bookmark, "lift-backup.json", json)

    await saveBackupState({
      bookmark: res.bookmark ?? state.bookmark,
      lastBackupAt: new Date().toISOString(),
      lastBackupError: null,
    })
    return "ok"
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await saveBackupState({ lastBackupError: message })
    return "error"
  } finally {
    inFlight = false
    if (pendingReason) {
      pendingReason = null
      // Re-arm via debounce so a flurry of writes during a slow backup
      // collapses into one follow-up rather than chaining immediately.
      scheduleDebouncedBackup()
    }
  }
}
