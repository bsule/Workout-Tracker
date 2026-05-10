/**
 * Mobile wrapper around @lift/core's buildFitnotesDb. Lazily loads sql.js's
 * pure-JS asm.js build (Hermes has no WASM) so the ~1.5MB bundle cost only
 * lands when the user taps "Export FitNotes DB".
 */

import { Asset } from "expo-asset"
import * as FileSystem from "expo-file-system/legacy"
import {
  buildFitnotesDb,
  timestampedFitnotesDbName,
  type SqlJsModule,
} from "@lift/core/export"
import type { Snapshot } from "@lift/core/store/schema"

// Module ID resolved by Metro. The .fitnotesdb extension is whitelisted in
// metro.config.js so this returns an asset reference, not a JS module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SKELETON_ASSET = require("../../assets/fitnotes_skeleton.fitnotesdb")

async function loadSkeletonBytes(): Promise<Uint8Array> {
  const asset = Asset.fromModule(SKELETON_ASSET)
  if (!asset.localUri) await asset.downloadAsync()
  const uri = asset.localUri ?? asset.uri
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return base64ToBytes(b64)
}

function base64ToBytes(b64: string): Uint8Array {
  // Hermes ships atob; fall back to a small decoder if not present.
  if (typeof globalThis.atob === "function") {
    const bin = globalThis.atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  const len = b64.length
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0
  const byteLen = (len * 3) / 4 - padding
  const out = new Uint8Array(byteLen)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const a = lookup[b64.charCodeAt(i)]
    const b = lookup[b64.charCodeAt(i + 1)]
    const c = lookup[b64.charCodeAt(i + 2)]
    const d = lookup[b64.charCodeAt(i + 3)]
    if (p < byteLen) out[p++] = (a << 2) | (b >> 4)
    if (p < byteLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < byteLen) out[p++] = ((c & 3) << 6) | d
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let bin = ""
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
      )
    }
    return globalThis.btoa(bin)
  }
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let out = ""
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      chars[(n >> 6) & 63] +
      chars[n & 63]
  }
  if (i < bytes.length) {
    const rem = bytes.length - i
    const n = (bytes[i] << 16) | (rem === 2 ? bytes[i + 1] << 8 : 0)
    out +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      (rem === 2 ? chars[(n >> 6) & 63] : "=") +
      "="
  }
  return out
}

/**
 * Build the .fitnotesdb bytes for the given snapshot, write them to the
 * cache directory, and return the local file URI for the caller to share.
 */
export async function writeFitnotesDbToCache(snap: Snapshot): Promise<{
  uri: string
  filename: string
}> {
  // Hermes lacks WASM; sql.js asm.js is pure JS and runs everywhere.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require("sql.js/dist/sql-asm.js") as (
    cfg?: unknown
  ) => Promise<SqlJsModule>
  const SQL = await initSqlJs()
  const skeletonBytes = await loadSkeletonBytes()

  const bytes = await buildFitnotesDb(snap, { skeletonBytes, SQL })

  const filename = timestampedFitnotesDbName()
  const uri = (FileSystem.cacheDirectory ?? "") + filename
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  })
  return { uri, filename }
}
