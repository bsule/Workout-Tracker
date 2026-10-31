/**
 * Recognises a push that is refused only because of this device's own earlier
 * push whose reply never arrived.
 *
 * The case: a phone pushes, R2 stores it, and iOS suspends the app before the
 * 200 comes back. The phone keeps its old etag, retries later with If-Match on
 * that old etag, and gets 412 against its own write. The user is then told the
 * cloud has newer data when it holds this device's own copy.
 *
 * Every write records two labels in the object's custom metadata:
 *   device: the install that wrote it (sent as ?device=, from the client)
 *   base:   the version that install wrote on top of
 *
 * Invariant: when the stored labels are {device: D, base: B}, every write since
 * version B was made by D. A normal write on If-Match B starts that run, and an
 * accepted retry keeps the run's B. Any write from another device, or from a
 * client that sends no device id, replaces the labels (R2 put never merges
 * metadata), which ends the run.
 *
 * So a refused push from D based on B, against labels {D, B}, has lost only to
 * D's own writes, and overwriting is what an acknowledged push would have done.
 * No Workers imports: the root test suite runs this against an in-memory bucket.
 */

/** The base label for a write made with If-None-Match: * (no object yet). */
export const NO_BASE = "none"

/** Accepts what newDeviceId() makes (a UUID, or its dev_ fallback). */
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** The client's device id, or null when absent or malformed. */
export function parseDeviceId(raw: string | undefined | null): string | null {
  return raw && DEVICE_ID.test(raw) ? raw : null
}

/** The version a push was based on: its If-Match etag, or NO_BASE. */
export function requestBase(ifMatch: string | undefined | null): string {
  if (!ifMatch) return NO_BASE
  return ifMatch.replace(/^"/, "").replace(/"$/, "")
}

/**
 * Metadata to store with a write. Undefined when the client sent no device
 * id: an older app writes no labels, which clears the previous ones.
 */
export function writeLabels(
  device: string | null,
  base: string
): Record<string, string> | undefined {
  return device ? { device, base } : undefined
}

/** True when the refused push lost only to this device's own writes. */
export function isOwnLostWrite(
  stored: Record<string, string> | undefined,
  device: string | null,
  base: string
): boolean {
  if (!device || !stored) return false
  return stored.device === device && stored.base === base
}

/** The slice of R2Bucket that putSnapshot uses. */
export interface SnapshotBucket {
  put(
    key: string,
    body: ArrayBuffer,
    options: {
      onlyIf: Headers | { etagMatches: string }
      httpMetadata: { contentType: string }
      customMetadata?: Record<string, string>
    }
  ): Promise<{ etag: string } | null>
  head(
    key: string
  ): Promise<{ etag: string; customMetadata?: Record<string, string> } | null>
}

export type PutOutcome =
  | { ok: true; etag: string }
  /** Refused. remoteEtag is the version the client lost to, if known. */
  | { ok: false; remoteEtag: string | null }

/**
 * The conditional write behind PUT /api/sync/snapshot. Writes on the client's
 * If-Match / If-None-Match. If that is refused only by this device's own
 * earlier writes, overwrites them instead, still conditional on the version
 * just read, so a write from another device in between is never lost.
 */
export async function putSnapshot(
  bucket: SnapshotBucket,
  key: string,
  body: ArrayBuffer,
  req: { ifMatch?: string; ifNoneMatch?: string; device: string | null }
): Promise<PutOutcome> {
  const onlyIf = new Headers()
  if (req.ifMatch) onlyIf.set("if-match", req.ifMatch)
  if (req.ifNoneMatch) onlyIf.set("if-none-match", req.ifNoneMatch)
  const base = requestBase(req.ifMatch)
  const httpMetadata = { contentType: "application/octet-stream" }
  const customMetadata = writeLabels(req.device, base)

  const written = await bucket.put(key, body, { onlyIf, httpMetadata, customMetadata })
  if (written) return { ok: true, etag: written.etag }

  // head() is a metadata read, so it costs no bandwidth, and a failure here
  // must not change the outcome.
  let current = await bucket.head(key).catch(() => null)
  if (current && isOwnLostWrite(current.customMetadata, req.device, base)) {
    // Keep the base: the run of this device's writes still starts there.
    const retried = await bucket.put(key, body, {
      onlyIf: { etagMatches: current.etag },
      httpMetadata,
      customMetadata,
    })
    if (retried) return { ok: true, etag: retried.etag }
    current = await bucket.head(key).catch(() => null)
  }
  return { ok: false, remoteEtag: current?.etag ?? null }
}
