import { Hono } from "hono"
import type { Env, Variables } from "../env"
import { hashPassword, verifyPassword } from "./password"
import { createToken, revokeToken } from "./tokens"
import { requireAuth } from "./middleware"

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

interface UserRow {
  id: number
  username: string
  email: string
  password_hash: string
}

auth.post("/signup/", async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return c.json({ detail: "Invalid JSON" }, 400)

  const username = str(body.username).trim()
  const email = str(body.email).trim()
  const password = str(body.password)

  if (!username) return c.json({ username: ["This field is required."] }, 400)
  if (!email || !email.includes("@") || !email.includes(".")) {
    return c.json({ email: ["Enter a valid email address."] }, 400)
  }
  if (password.length < 8) {
    return c.json({ password: ["Password must be at least 8 characters."] }, 400)
  }

  const conflict = await c.env.DB
    .prepare(
      "SELECT username, email FROM users WHERE username = ?1 COLLATE NOCASE OR email = ?2 COLLATE NOCASE LIMIT 1"
    )
    .bind(username, email)
    .first<{ username: string; email: string }>()
  if (conflict) {
    if (conflict.username.toLowerCase() === username.toLowerCase()) {
      return c.json({ username: ["A user with that username already exists."] }, 400)
    }
    return c.json({ email: ["A user with that email already exists."] }, 400)
  }

  const passwordHash = await hashPassword(password)
  const inserted = await c.env.DB
    .prepare(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?) RETURNING id"
    )
    .bind(username, email, passwordHash)
    .first<{ id: number }>()
  if (!inserted) return c.json({ detail: "Failed to create user." }, 500)

  const token = await createToken(c.env.DB, inserted.id)
  return c.json({ token, user: { id: inserted.id, username, email } }, 201)
})

auth.post("/login/", async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return c.json({ detail: "Invalid JSON" }, 400)

  const username = str(body.username).trim()
  const password = str(body.password)
  if (!username || !password) {
    return c.json({ detail: "Unable to log in with provided credentials." }, 400)
  }

  const user = await c.env.DB
    .prepare(
      "SELECT id, username, email, password_hash FROM users WHERE username = ? COLLATE NOCASE LIMIT 1"
    )
    .bind(username)
    .first<UserRow>()
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ detail: "Unable to log in with provided credentials." }, 400)
  }

  const token = await createToken(c.env.DB, user.id)
  return c.json({
    token,
    user: { id: user.id, username: user.username, email: user.email },
  })
})

auth.post("/logout/", requireAuth, async (c) => {
  await revokeToken(c.env.DB, c.get("token"))
  return c.body(null, 204)
})

auth.get("/me/", requireAuth, (c) => c.json(c.get("user")))

auth.patch("/me/", requireAuth, async (c) => {
  const me = c.get("user")
  const body = await readJson(c.req.raw)
  if (!body) return c.json({ detail: "Invalid JSON" }, 400)

  const nextUsername =
    body.username !== undefined ? str(body.username).trim() : null
  const nextEmail = body.email !== undefined ? str(body.email).trim() : null

  if (nextUsername !== null) {
    if (!nextUsername) return c.json({ username: ["This field is required."] }, 400)
    const conflict = await c.env.DB
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?")
      .bind(nextUsername, me.id)
      .first()
    if (conflict) {
      return c.json({ username: ["A user with that username already exists."] }, 400)
    }
  }
  if (nextEmail !== null) {
    if (!nextEmail || !nextEmail.includes("@") || !nextEmail.includes(".")) {
      return c.json({ email: ["Enter a valid email address."] }, 400)
    }
    const conflict = await c.env.DB
      .prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?")
      .bind(nextEmail, me.id)
      .first()
    if (conflict) {
      return c.json({ email: ["A user with that email already exists."] }, 400)
    }
  }

  const sets: string[] = []
  const params: unknown[] = []
  if (nextUsername !== null) {
    sets.push("username = ?")
    params.push(nextUsername)
  }
  if (nextEmail !== null) {
    sets.push("email = ?")
    params.push(nextEmail)
  }
  if (sets.length > 0) {
    params.push(me.id)
    await c.env.DB
      .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run()
  }

  const updated = await c.env.DB
    .prepare("SELECT id, username, email FROM users WHERE id = ?")
    .bind(me.id)
    .first<{ id: number; username: string; email: string }>()
  return c.json(updated)
})

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data = (await req.json()) as unknown
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}
