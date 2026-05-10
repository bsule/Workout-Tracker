import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env, Variables } from "./env"
import { auth } from "./auth/routes"
import { sync } from "./sync/routes"

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use("*", (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "If-Match",
      "If-None-Match",
    ],
    exposeHeaders: ["ETag"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next)
})

app.route("/api/auth", auth)
app.route("/api/sync", sync)

app.get("/", (c) => c.text("lift-api"))
app.notFound((c) => c.json({ detail: "Not found." }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ detail: "Internal server error." }, 500)
})

export default app
