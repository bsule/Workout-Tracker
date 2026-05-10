import BackupFolder from "../../modules/backup-folder"

export type FolderBookmark = string

export interface PickedFolder {
  bookmark: FolderBookmark
  label: string
}

export type ReadResult =
  | { ok: true; contents: string }
  | { ok: false; error: "not-found" | "denied" | "other" | "unavailable"; message: string }

/**
 * False in Expo Go (no custom native code can load there). The settings UI
 * shows a "build a dev build to enable" message in that case rather than
 * a broken set-up button.
 */
export function isBackupFolderAvailable(): boolean {
  return BackupFolder != null
}

const UNAVAILABLE_MSG =
  "Backup folder picker requires a development build. This feature is disabled in Expo Go."

export const folderBridge = {
  async pickFolder(): Promise<PickedFolder | null> {
    if (!BackupFolder) throw new Error(UNAVAILABLE_MSG)
    const res = await BackupFolder.pickFolder()
    if (!res) return null
    return { bookmark: res.bookmark, label: res.label }
  },

  async writeFile(
    bookmark: FolderBookmark,
    filename: string,
    contents: string
  ): Promise<{ bookmark?: FolderBookmark }> {
    if (!BackupFolder) throw new Error(UNAVAILABLE_MSG)
    const res = await BackupFolder.writeFile(bookmark, filename, contents)
    return { bookmark: res.bookmark }
  },

  async readFile(
    bookmark: FolderBookmark,
    filename: string
  ): Promise<ReadResult> {
    if (!BackupFolder) {
      return { ok: false, error: "unavailable", message: UNAVAILABLE_MSG }
    }
    try {
      const res = await BackupFolder.readFile(bookmark, filename)
      return { ok: true, contents: res.contents }
    } catch (e) {
      const code = errorCode(e)
      const message = e instanceof Error ? e.message : String(e)
      return { ok: false, error: code, message }
    }
  },
}

function errorCode(e: unknown): "not-found" | "denied" | "other" {
  const code = (e as { code?: string }).code
  if (code === "not-found") return "not-found"
  if (code === "denied") return "denied"
  return "other"
}
