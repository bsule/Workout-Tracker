import type { MiddlewareHandler } from "hono"
import { lookupToken } from "./tokens"
import type { Env, Variables } from "../env"

export const requireAuth: MiddlewareHandler<{
  Bindings: Env
  Variables: Variables
}> = async (c, next) => {
  const header = c.req.header("authorization") ?? ""
  const match = header.match(/^Token\s+(.+)$/i)
  if (!match) return c.json({ detail: "Authentication credentials were not provided." }, 401)
  const token = match[1].trim()
  const user = await lookupToken(c.env.DB, token)
  if (!user) return c.json({ detail: "Invalid token." }, 401)
  c.set("user", user)
  c.set("token", token)
  await next()
}
