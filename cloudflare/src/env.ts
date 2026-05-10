export interface Env {
  DB: D1Database
  SNAPSHOTS: R2Bucket
  ALLOWED_ORIGINS: string
}

export interface Variables {
  user: { id: number; username: string; email: string }
  token: string
}
