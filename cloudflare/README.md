# lift-api (Cloudflare Worker)

Auth and snapshot sync for the web and mobile clients. Auth lives in D1 (`lift-auth`); the per-user snapshot blob lives in R2 (`lift-snapshots`).

## Endpoints

Auth:

- `POST /api/auth/signup/` → `{ token, user }`
- `POST /api/auth/login/` → `{ token, user }`
- `POST /api/auth/logout/` → 204
- `GET /api/auth/me/` → `user`
- `PATCH /api/auth/me/` → `user`

Sync:

- `GET /api/sync/snapshot` → 200 raw bytes + `ETag`, or 204 if no snapshot exists
- `PUT /api/sync/snapshot` → 200 `{ etag }`. Required header: `If-Match: "<etag>"` (overwrite) or `If-None-Match: *` (first write). 412 on stale etag.

All routes (except `/api/auth/signup` and `/api/auth/login`) require `Authorization: Token <hex>`.

## First-time setup (already done for this repo)

```sh
npm i -g wrangler
wrangler login
wrangler d1 create lift-auth        # database_id is in wrangler.toml
wrangler r2 bucket create lift-snapshots
```

## Local dev

```sh
cd cloudflare
npm install
npm run db:apply:local              # apply migrations to local D1 simulator
npm run dev                         # wrangler dev on http://localhost:8787
```

Then point the clients at the worker:

- **Web** (`frontend/.env.local`): `NEXT_PUBLIC_API_BASE_URL=http://localhost:8787/api`
- **Mobile** (`mobile/app.json` → `expo.extra.apiBaseUrl`): `http://localhost:8787/api` (use your LAN IP, not localhost, when testing on a real device).

## Deploy

```sh
npm run db:apply:remote             # apply migrations to production D1
npm run deploy                      # publishes to https://lift-api.<account>.workers.dev
```

After the first deploy:

1. Find the URL Wrangler prints (or attach a custom domain in the Cloudflare dashboard).
2. Update production `NEXT_PUBLIC_API_BASE_URL` to `<url>/api`.
3. Update `ALLOWED_ORIGINS` in `wrangler.toml` to include your production frontend origin, then redeploy.

## Smoke test

```sh
# Sign up
curl -X POST http://localhost:8787/api/auth/signup/ \
  -H 'content-type: application/json' \
  -d '{"username":"alice","email":"a@a.test","password":"hunter22!"}'
# → {"token":"<hex>","user":{"id":1,"username":"alice","email":"a@a.test"}}

TOKEN=<paste-hex>

# First push (no prior snapshot)
echo -n "test snapshot bytes" | \
  curl -X PUT http://localhost:8787/api/sync/snapshot \
    -H "authorization: Token $TOKEN" \
    -H 'if-none-match: *' \
    --data-binary @-
# → {"etag":"<md5>"}

# Pull
curl -i http://localhost:8787/api/sync/snapshot \
  -H "authorization: Token $TOKEN"
# → 200, ETag header, body = test snapshot bytes

# Stale push
echo -n "newer bytes" | \
  curl -X PUT http://localhost:8787/api/sync/snapshot \
    -H "authorization: Token $TOKEN" \
    -H 'if-match: "deadbeef"' \
    --data-binary @-
# → 412 Precondition Failed
```

## Layout

```
cloudflare/
├── wrangler.toml             # Worker name + bindings (DB, SNAPSHOTS, ALLOWED_ORIGINS)
├── migrations/
│   └── 0001_init.sql         # users, tokens
└── src/
    ├── index.ts              # Hono app + CORS
    ├── env.ts                # Env / Variables types for Hono
    ├── auth/
    │   ├── routes.ts         # signup/login/logout/me
    │   ├── password.ts       # PBKDF2-SHA256 (Web Crypto)
    │   ├── tokens.ts         # 32-byte hex token + D1 lookup/revoke
    │   └── middleware.ts     # requireAuth
    └── sync/
        └── routes.ts         # GET/PUT snapshot, R2 conditional puts
```

## Notes

- Passwords are hashed with PBKDF2-SHA256 at 100,000 iterations. If the free-tier 10ms CPU budget bites under load, either bump the Workers plan ($5/mo) or lower iterations in `src/auth/password.ts`.
- `password_hash` format is `pbkdf2_sha256$<iters>$<salt-b64>$<key-b64>`.
- R2's `etag` is the upload identifier (MD5 for small objects). It's opaque to the client; treat it as a version cookie.
