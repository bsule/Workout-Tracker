# lift-client (web)

Next.js 16 + React 19 + Tailwind. Local-first: workouts, exercises, sets, settings, gyms, imports, and exports all live in IndexedDB. Auth and snapshot sync go through the Cloudflare Worker in [cloudflare/](../cloudflare/).

The shared store, sync transport, and FitNotes import/export logic live in [`@lift/core`](../packages/core).

## Dev

```bash
npm install
npm run dev          # http://localhost:3215
```

The Worker must be running on `http://localhost:8787` (see [cloudflare/README.md](../cloudflare/README.md)) — or point elsewhere via `NEXT_PUBLIC_API_BASE_URL` in `.env.local`.

## Build

```bash
npm run build
npm run start
```

## Notable paths

- `app/` — App Router pages and layouts.
- `components/` — UI primitives (`ui/`), feature components, providers (`auth/`, `settings/`, `categories/`).
- `lib/api.ts` — auth + profile network calls only. Everything else is local.
- `lib/store/` — IndexedDB-backed store wrapping `@lift/core`.
- `lib/fitnotes/` — FitNotes `.csv` / `.fitnotesdb` import/export glue.
