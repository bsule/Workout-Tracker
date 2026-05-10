import { Hono } from "hono"
import type { Env, Variables } from "../env"
import { requireAuth } from "../auth/middleware"

export const sync = new Hono<{ Bindings: Env; Variables: Variables }>()

sync.use("*", requireAuth)

const objectKey = (userId: number) => `users/${userId}/snapshot.bin`

/** Daily push budget per user (UTC). Pulls are unrestricted. */
const DAILY_PUSH_LIMIT = 5

interface Quota {
  used: number
  limit: number
  remaining: number
  resets_at: string
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextUtcMidnight(): string {
  const d = new Date()
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

async function readQuota(db: D1Database, userId: number): Promise<Quota> {
  const row = await db
    .prepare("SELECT count FROM sync_quota WHERE user_id = ? AND date = ?")
    .bind(userId, utcDate())
    .first<{ count: number }>()
  const used = row?.count ?? 0
  return {
    used,
    limit: DAILY_PUSH_LIMIT,
    remaining: Math.max(0, DAILY_PUSH_LIMIT - used),
    resets_at: nextUtcMidnight(),
  }
}

async function incrementQuota(db: D1Database, userId: number): Promise<Quota> {
  const date = utcDate()
  const row = await db
    .prepare(
      "INSERT INTO sync_quota (user_id, date, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 " +
        "RETURNING count"
    )
    .bind(userId, date)
    .first<{ count: number }>()
  const used = row?.count ?? 1
  return {
    used,
    limit: DAILY_PUSH_LIMIT,
    remaining: Math.max(0, DAILY_PUSH_LIMIT - used),
    resets_at: nextUtcMidnight(),
  }
}

sync.get("/quota", async (c) => {
  const quota = await readQuota(c.env.DB, c.get("user").id)
  return c.json(quota)
})

sync.get("/snapshot", async (c) => {
  const obj = await c.env.SNAPSHOTS.get(objectKey(c.get("user").id))
  if (!obj) return c.body(null, 204)
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "etag": `"${obj.etag}"`,
      "cache-control": "no-store",
    },
  })
})

sync.put("/snapshot", async (c) => {
  const userId = c.get("user").id

  const ifMatch = c.req.header("if-match")
  const ifNoneMatch = c.req.header("if-none-match")
  if (!ifMatch && ifNoneMatch !== "*") {
    return c.json(
      {
        detail:
          "If-Match: <etag> (overwrite) or If-None-Match: * (first write) required.",
      },
      428
    )
  }

  // Pre-check quota. We'll re-read after the R2 PUT to handle the rare race
  // of two PUTs in flight; failed pushes (412) don't increment.
  const before = await readQuota(c.env.DB, userId)
  if (before.remaining <= 0) {
    return c.json(
      {
        detail: `Daily sync limit reached (${before.limit}/day). Resets at ${before.resets_at}.`,
        quota: before,
      },
      429
    )
  }

  const conditional = new Headers()
  if (ifMatch) conditional.set("if-match", ifMatch)
  if (ifNoneMatch) conditional.set("if-none-match", ifNoneMatch)

  const body = await c.req.arrayBuffer()
  const result = await c.env.SNAPSHOTS.put(
    objectKey(userId),
    body,
    {
      onlyIf: conditional,
      httpMetadata: { contentType: "application/octet-stream" },
    }
  )

  if (!result) {
    return c.json(
      { detail: "Snapshot has changed remotely; pull and retry.", quota: before },
      412
    )
  }

  const quota = await incrementQuota(c.env.DB, userId)
  return c.json({ etag: result.etag, quota })
})
