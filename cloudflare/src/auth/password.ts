// Argon2 / scrypt aren't in Workers' Web Crypto, so we use PBKDF2-SHA256.
// Iteration count is a tradeoff: too low weakens hashes, too high blows the
// 10ms CPU budget on Workers free tier. 100k is OWASP's 2023 PBKDF2-SHA256
// minimum and finishes in well under 100ms.
const ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await derive(password, salt, ITERATIONS, KEY_BYTES)
  return `pbkdf2_sha256$${ITERATIONS}$${b64(salt)}$${b64(key)}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split("$")
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = unb64(parts[2])
  const expected = unb64(parts[3])
  const got = await derive(password, salt, iterations, expected.length)
  return timingSafeEqual(got, expected)
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bytes: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    bytes * 8
  )
  return new Uint8Array(bits)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function b64(bytes: Uint8Array): string {
  let s = ""
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
