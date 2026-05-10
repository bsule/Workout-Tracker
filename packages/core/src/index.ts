// Public surface of @lift/core. Hosts (frontend/web, mobile RN) import from
// here. They MUST call setStorageFactory(...) before configure()/hydrate().

export * from "./types"
export * from "./units"
export * from "./store"
export type { BlobStorage } from "./store/storage/types"
export {
  setStorageFactory,
  configure as configureStore,
  hydrate as hydrateStore,
  flushNow,
  flushOnHide,
  runBatched,
  addFlushListener,
  removeFlushListener,
} from "./store/persist"
export * as sync from "./sync"
export * as autoSync from "./sync/autoSync"
export type { RemotePreview } from "./sync/autoSync"
export {
  CloudflareTransport,
  StaleSnapshotError,
  SyncQuotaExceededError,
} from "./sync/cloudflareTransport"
export type {
  CloudflareTransportOptions,
  Quota,
} from "./sync/cloudflareTransport"
