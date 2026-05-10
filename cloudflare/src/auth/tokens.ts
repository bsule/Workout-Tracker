export interface UserRow {
  id: number
  username: string
  email: string
}

export async function createToken(db: D1Database, userId: number): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  await db
    .prepare("INSERT INTO tokens (token, user_id) VALUES (?, ?)")
    .bind(token, userId)
    .run()
  return token
}

export async function lookupToken(
  db: D1Database,
  token: string
): Promise<UserRow | null> {
  const row = await db
    .prepare(
      "SELECT u.id AS id, u.username AS username, u.email AS email " +
        "FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?"
    )
    .bind(token)
    .first<UserRow>()
  return row ?? null
}

export async function revokeToken(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM tokens WHERE token = ?").bind(token).run()
}
