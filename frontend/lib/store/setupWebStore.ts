"use client"
import { setStorageFactory, flushOnHide, getState } from "@lift/core"
import { pickWebStorage } from "./storage"
import { encodeSnapshot, setSnapshotEncoder } from "@lift/core/store/blob"
import { createSnapshotEncoder } from "./snapshotWorker"

let installed = false

/**
 * One-time install of the web storage adapter (IDB/OPFS) and lifecycle wiring
 * (visibilitychange/pagehide → flushOnHide). Idempotent; safe to call from
 * any client provider on mount.
 */
export function installWebStore() {
  if (installed) return
  installed = true
  setStorageFactory((sub) => pickWebStorage(sub))
  if (typeof window !== "undefined") {
    // The worker keeps JSON and gzip off the UI thread. If it cannot load,
    // the encoder falls back to the portable one so saves still work.
    setSnapshotEncoder(createSnapshotEncoder(
      () => new Worker("/workers/snapshot.js"),
      encodeSnapshot
    ))
    const onHide = () => { if (getState().hydrated) flushOnHide() }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide()
    })
    window.addEventListener("pagehide", onHide)
    // Best-effort persistent storage hint (asks the browser not to evict IDB).
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {})
    }
  }
}
