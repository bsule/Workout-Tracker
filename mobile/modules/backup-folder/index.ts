import { requireOptionalNativeModule } from "expo-modules-core"

export interface PickFolderResult {
  bookmark: string
  label: string
}

export interface WriteFileResult {
  bookmark?: string
}

interface NativeModule {
  pickFolder(): Promise<PickFolderResult | null>
  writeFile(
    bookmark: string,
    filename: string,
    contents: string
  ): Promise<WriteFileResult>
  readFile(bookmark: string, filename: string): Promise<{ contents: string }>
}

// Returns null in Expo Go (no custom native code can load there) and in any
// other host that lacks the BackupFolderModule. Callers MUST handle the null
// case — see isBackupFolderAvailable() in mobile/src/backup/folderBridge.ts.
const native = requireOptionalNativeModule<NativeModule>("BackupFolderModule")

export default native
