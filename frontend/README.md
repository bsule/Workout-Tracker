# lift-client (web)

Next.js 16 + React 19 + Tailwind. Local-first: workouts, exercises, sets, settings, gyms, and notes all live in one gzipped blob on the device. Storage is OPFS where the browser supports it, with an IndexedDB fallback. Auth and snapshot sync go through the Cloudflare Worker in [cloudflare/](../cloudflare/).

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

There is no `typecheck` script. Run `npx tsc --noEmit` directly. `npm run lint`
runs eslint.

## Notable paths

- `app/` — App Router pages and layouts.
- `components/` — UI primitives (`ui/`), feature components, providers (`auth/`, `settings/`, `categories/`).
- `lib/api.ts` — auth + profile network calls only. Everything else is local.
- `lib/store/` — mostly re-exports `@lift/core/store`. `setupWebStore.ts` injects the browser storage adapter; `storage/` holds the OPFS and IndexedDB backends.
- `lib/syncStorage.ts` — device-local sync state (R2 etag, "last synced") in localStorage. Best-effort: writes may throw in private mode.
- `lib/fitnotes/` — FitNotes `.csv` / `.fitnotesdb` import/export glue.
- `lib/exports/` — DOM-only download helpers. Serialization itself lives in `@lift/core/export`.
- `lib/ai/` — BYO-key workout planning. `providers/` (anthropic, openai, gemini, deepseek), context building, prompts, parsing, and `applyPlan.ts`. No server side.
