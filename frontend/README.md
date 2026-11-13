# lift-client (web)

Next.js 16 + React 19 + Tailwind. Local-first: workouts, exercises, sets, settings, gyms, and notes all live in one gzipped blob on the device. Storage is OPFS where the browser supports it, with an IndexedDB fallback. Restore points (the previous save, a daily copy, and an undo copy taken before a file import or cloud pull) live in a separate IndexedDB database, scoped per account. Only one tab edits the store at a time, through a Web Lock. Auth and snapshot sync go through the Cloudflare Worker in [cloudflare/](../cloudflare/).

The shared store, sync transport, AI planning, and FitNotes import/export logic live in [`@lift/core`](../packages/core).

## Dev

```bash
npm install
npm run dev          # http://localhost:3215
```

The Worker must be running on `http://localhost:8787` (see [cloudflare/README.md](../cloudflare/README.md)). To point elsewhere, set `NEXT_PUBLIC_API_BASE_URL` in `.env.local`.

## Build

```bash
npm run build
npm run start
```

There is no `typecheck` script. Run `npx tsc --noEmit` directly. `npm run lint`
runs eslint.

Dev and build scripts automatically bundle `lib/store/snapshot.worker.ts` into
`public/workers/snapshot.js` (gitignored). The worker handles JSON encoding and
gzip for disk saves, uploads and recovery copies. If running Next directly,
first run `node scripts/build-snapshot-worker.mjs` from the repository root.

## Notable paths

- `app/`: App Router pages and layouts. `/ai-plan` and `/settings/ai` currently redirect away.
- `components/`: UI primitives (`ui/`), feature components, providers (`auth/`, `settings/`, `categories/`).
  - `workouts/` holds the set logger, the "since last set" `RestTicker`, and the `LastTimePanel` (last session plus top weights by set position).
  - `store/` holds `StoreProvider` (configure and hydrate per account) and `StoreOwner` (the `lift:store-editor` Web Lock that keeps a second tab from editing).
  - `sync/` holds the cloud conflict prompt, the restore screen, and `LocalRestorePoints`.
  - `ai/` holds the AI plan and AI settings pages (parked for now).
- `lib/api.ts`: auth + profile network calls only. Everything else is local.
- `lib/store/`: mostly re-exports `@lift/core/store`. `setupWebStore.ts` injects the browser storage adapter; `storage/` holds the OPFS and IndexedDB backends and `recovery.ts` (restore point slots); `restorePoints.ts` lists and restores them.
- `lib/syncStorage.ts`: device-local sync state (R2 etag, "last synced", device id) in localStorage. Best-effort: writes may throw in private mode.
- `lib/fitnotes/`: FitNotes `.csv` / `.fitnotesdb` import/export glue.
- `lib/exports/`: DOM-only download helpers. Serialization itself lives in `@lift/core/export`.
- `lib/ai/`: `index.ts` re-exports `@lift/core/ai` (with direct browser access turned on for Anthropic); `keys.ts` keeps the user's API keys in localStorage. No server side.
