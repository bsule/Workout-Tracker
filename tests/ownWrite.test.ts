import { describe, it, expect } from "vitest"
import {
  NO_BASE,
  isOwnLostWrite,
  parseDeviceId,
  putSnapshot,
  requestBase,
  writeLabels,
  type SnapshotBucket,
} from "../cloudflare/src/sync/ownWrite"

// The worker's conditional write, run against an in-memory bucket with R2's
// semantics: onlyIf decides, and every put replaces custom metadata whole.

interface Stored {
  etag: string
  body: string
  customMetadata?: Record<string, string>
}

function fakeBucket() {
  let object: Stored | null = null
  let n = 0
  /** Runs once after the next head(): another device writing in between. */
  let afterHead: (() => void) | null = null

  const bucket: SnapshotBucket = {
    async put(_key, body, { onlyIf, customMetadata }) {
      if (onlyIf instanceof Headers) {
        const ifMatch = onlyIf.get("if-match")
        const ifNoneMatch = onlyIf.get("if-none-match")
        if (ifMatch && ifMatch.replace(/"/g, "") !== object?.etag) return null
        if (ifNoneMatch === "*" && object) return null
      } else if (onlyIf.etagMatches !== object?.etag) {
        return null
      }
      object = {
        etag: `e${++n}`,
        body: new TextDecoder().decode(body),
        customMetadata: customMetadata ? { ...customMetadata } : undefined,
      }
      return { etag: object.etag }
    },
    async head() {
      const seen = object && { ...object }
      const hook = afterHead
      afterHead = null
      hook?.()
      return seen
    },
  }
  return {
    bucket,
    get: () => object,
    raceAfterHead(fn: () => void) {
      afterHead = fn
    },
  }
}

const KEY = "users/1/snapshot.bin"
const PHONE = "11111111-1111-4111-8111-111111111111"
const WEB = "22222222-2222-4222-8222-222222222222"
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

/** A client that pushes like CloudflareTransport: If-Match on its known etag. */
function client(b: SnapshotBucket, device: string | null) {
  let etag: string | null = null
  return {
    get etag() {
      return etag
    },
    set etag(e: string | null) {
      etag = e
    },
    /** Push and receive the reply. */
    async push(body: string) {
      const out = await putSnapshot(b, KEY, bytes(body), {
        ...(etag ? { ifMatch: `"${etag}"` } : { ifNoneMatch: "*" }),
        device,
      })
      if (out.ok) etag = out.etag
      return out
    },
    /** Push, but the reply never arrives (app suspended mid-request). */
    async pushLostReply(body: string) {
      await putSnapshot(b, KEY, bytes(body), {
        ...(etag ? { ifMatch: `"${etag}"` } : { ifNoneMatch: "*" }),
        device,
      })
    },
  }
}

describe("putSnapshot: the lost reply", () => {
  it("accepts a retry refused only by this device's own lost push", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    await phone.push("v1")
    await phone.pushLostReply("v2")
    const out = await phone.push("v3")
    expect(out.ok).toBe(true)
    expect(r2.get()?.body).toBe("v3")
  })

  it("accepts it after several replies in a row are lost", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    await phone.push("v1")
    await phone.pushLostReply("v2")
    await phone.pushLostReply("v3")
    await phone.pushLostReply("v4")
    expect((await phone.push("v5")).ok).toBe(true)
    expect(r2.get()?.body).toBe("v5")
  })

  it("accepts it when the lost push was the device's first (If-None-Match: *)", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    await phone.pushLostReply("v1")
    expect((await phone.push("v2")).ok).toBe(true)
    expect(r2.get()?.body).toBe("v2")
  })

  it("keeps working normally after the recovery", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    await phone.push("v1")
    await phone.pushLostReply("v2")
    await phone.push("v3")
    // v1 = e1, lost v2 = e2, recovered v3 = e3; v4 is a plain write on e3.
    expect((await phone.push("v4")).ok).toBe(true)
    expect(r2.get()?.customMetadata).toEqual({ device: PHONE, base: "e3" })
  })
})

describe("putSnapshot: real conflicts still refuse", () => {
  it("refuses when another device wrote since this device's version", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    const web = client(r2.bucket, WEB)
    await phone.push("phone v1")
    web.etag = phone.etag
    await web.push("web v2")
    const out = await phone.push("phone v3")
    expect(out).toEqual({ ok: false, remoteEtag: r2.get()?.etag })
    expect(r2.get()?.body).toBe("web v2")
  })

  it("refuses when another device wrote after this device's lost push", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    const web = client(r2.bucket, WEB)
    await phone.push("phone v1")
    await phone.pushLostReply("phone v2")
    web.etag = r2.get()!.etag // web pulled phone v2
    await web.push("web v3")
    expect((await phone.push("phone v4")).ok).toBe(false)
    expect(r2.get()?.body).toBe("web v3")
  })

  it("refuses when another device writes between the check and the retry", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    const web = client(r2.bucket, WEB)
    await phone.push("v1")
    await phone.pushLostReply("v2")
    r2.raceAfterHead(() => {
      web.etag = r2.get()!.etag
      void web.push("web wins")
    })
    const out = await phone.push("phone v3")
    expect(out.ok).toBe(false)
    expect(r2.get()?.body).toBe("web wins")
    if (!out.ok) expect(out.remoteEtag).toBe(r2.get()?.etag)
  })

  it("refuses a push based on a different version than the run started on", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    await phone.push("v1")
    await phone.push("v2")
    phone.etag = "some-older-etag"
    expect((await phone.push("v3")).ok).toBe(false)
  })

  it("refuses a fresh install (new device id) against an existing cloud copy", async () => {
    const r2 = fakeBucket()
    await client(r2.bucket, PHONE).push("old install")
    const reinstalled = client(r2.bucket, WEB)
    expect((await reinstalled.push("empty")).ok).toBe(false)
    expect(r2.get()?.body).toBe("old install")
  })
})

describe("putSnapshot: apps that have not updated", () => {
  it("writes exactly as before when no device id is sent", async () => {
    const r2 = fakeBucket()
    const old = client(r2.bucket, null)
    expect((await old.push("v1")).ok).toBe(true)
    expect((await old.push("v2")).ok).toBe(true)
    expect(r2.get()?.customMetadata).toBeUndefined()
  })

  it("still refuses an old app's stale push, with the cloud etag", async () => {
    const r2 = fakeBucket()
    const old = client(r2.bucket, null)
    await old.push("v1")
    await old.pushLostReply("v2")
    const out = await old.push("v3")
    expect(out).toEqual({ ok: false, remoteEtag: r2.get()?.etag })
  })

  it("an old app's write clears the labels, so it is never mistaken for the device's own", async () => {
    const r2 = fakeBucket()
    const phone = client(r2.bucket, PHONE)
    const oldWeb = client(r2.bucket, null)
    await phone.push("v1")
    await phone.pushLostReply("v2")
    oldWeb.etag = r2.get()!.etag
    await oldWeb.push("old web v3")
    expect(r2.get()?.customMetadata).toBeUndefined()
    expect((await phone.push("phone v4")).ok).toBe(false)
    expect(r2.get()?.body).toBe("old web v3")
  })

  it("a cloud copy written before this change is never overwritten on a refusal", async () => {
    const r2 = fakeBucket()
    await client(r2.bucket, null).push("pre-deploy copy")
    const phone = client(r2.bucket, PHONE)
    expect((await phone.push("v2")).ok).toBe(false)
    expect(r2.get()?.body).toBe("pre-deploy copy")
  })

  it("an updated app's normal push on the right etag labels the copy", async () => {
    const r2 = fakeBucket()
    const old = client(r2.bucket, null)
    await old.push("pre-deploy copy")
    const phone = client(r2.bucket, PHONE)
    phone.etag = old.etag
    expect((await phone.push("v2")).ok).toBe(true)
    expect(r2.get()?.customMetadata).toEqual({ device: PHONE, base: old.etag })
  })
})

describe("helpers", () => {
  it("parseDeviceId accepts UUIDs and the dev_ fallback, rejects junk", () => {
    expect(parseDeviceId(PHONE)).toBe(PHONE)
    expect(parseDeviceId("dev_k3j4h5g6_1760000000000")).toBe("dev_k3j4h5g6_1760000000000")
    expect(parseDeviceId(undefined)).toBeNull()
    expect(parseDeviceId("")).toBeNull()
    expect(parseDeviceId("short")).toBeNull()
    expect(parseDeviceId("has spaces in it")).toBeNull()
    expect(parseDeviceId("x".repeat(65))).toBeNull()
  })

  it("requestBase strips quotes and marks a first write", () => {
    expect(requestBase('"abc"')).toBe("abc")
    expect(requestBase(undefined)).toBe(NO_BASE)
  })

  it("writeLabels is empty without a device", () => {
    expect(writeLabels(null, "abc")).toBeUndefined()
    expect(writeLabels(PHONE, "abc")).toEqual({ device: PHONE, base: "abc" })
  })

  it("isOwnLostWrite needs the same device and the same base", () => {
    const stored = { device: PHONE, base: "abc" }
    expect(isOwnLostWrite(stored, PHONE, "abc")).toBe(true)
    expect(isOwnLostWrite(stored, WEB, "abc")).toBe(false)
    expect(isOwnLostWrite(stored, PHONE, "other")).toBe(false)
    expect(isOwnLostWrite(stored, null, "abc")).toBe(false)
    expect(isOwnLostWrite(undefined, PHONE, "abc")).toBe(false)
  })
})
