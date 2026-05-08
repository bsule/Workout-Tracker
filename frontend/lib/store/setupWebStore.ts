"use client"
import { setStorageFactory, flushOnHide } from "@lift/core"
import { pickWebStorage } from "./storage"

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
    const onHide = () => flushOnHide()
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
