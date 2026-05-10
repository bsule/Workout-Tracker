import AsyncStorage from "@react-native-async-storage/async-storage"

const KEY = "lift.backup.v1"

export interface BackupState {
  bookmark: string | null
  folderLabel: string | null
  lastBackupAt: string | null
  lastBackupError: string | null
}

const empty: BackupState = {
  bookmark: null,
  folderLabel: null,
  lastBackupAt: null,
  lastBackupError: null,
}

let cache: BackupState | null = null
const listeners = new Set<(s: BackupState) => void>()

export async function loadBackupState(): Promise<BackupState> {
  if (cache) return cache
  try {
    const raw = await AsyncStorage.getItem(KEY)
    cache = raw ? { ...empty, ...(JSON.parse(raw) as Partial<BackupState>) } : empty
  } catch {
    cache = empty
  }
  return cache
}

export function getBackupStateSync(): BackupState {
  return cache ?? empty
}

export async function saveBackupState(
  patch: Partial<BackupState>
): Promise<BackupState> {
  const current = await loadBackupState()
  const next = { ...current, ...patch }
  cache = next
  await AsyncStorage.setItem(KEY, JSON.stringify(next))
  for (const fn of listeners) {
    try {
      fn(next)
    } catch {
      // listeners shouldn't throw; swallow so one bad subscriber can't kill the rest.
    }
  }
  return next
}

export function subscribeBackupState(
  fn: (s: BackupState) => void
): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
