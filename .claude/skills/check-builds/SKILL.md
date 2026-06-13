---
name: check-builds
description: Run the build/type/lint checks for this monorepo and fix what breaks. Use after changing code in packages/core, frontend, mobile, or cloudflare, before claiming work is done.
---

# Build & Type Checker (workouttracker monorepo)

There is **no test runner** in this repo, so type/lint/build checks are the main
automated safety net. The check commands differ per workspace and are easy to get
wrong — run the right one for each package you touched, fix failures, re-run until clean.

## Per-workspace checks

Run from inside each folder (or with `npm --workspace <pkg> run <script>` from root).

### frontend (`lift-client`)
There is **no `typecheck` npm script** — run tsc directly.
```bash
cd frontend && npx tsc --noEmit     # type check
cd frontend && npm run lint         # eslint (the only configured lint)
cd frontend && npm run build        # next build — slowest; run when types+lint pass
```

### mobile (`lift-mobile`)
```bash
cd mobile && npm run typecheck      # tsc --noEmit
```
There is no JS build to run locally; native builds go through EAS/GitHub Actions
(`npm run ipa:gh`) and are out of scope for a routine check.

### cloudflare (worker)
```bash
cd cloudflare && npm run typecheck  # tsc --noEmit
```
Don't run `npm run deploy` as a "build check" — it deploys to production.

### packages/core (`@lift/core`)
Has no scripts of its own. It is type-checked transitively whenever `frontend` or
`mobile` type-check (both import it), so a core change is covered by running those.
To check it in isolation:
```bash
cd packages/core && npx tsc --noEmit -p tsconfig.json
```

## Which checks to run

Only run checks for what you changed:
- Changed `packages/core` → run **frontend `tsc`** and **mobile typecheck** (both consume it).
- Changed `frontend` → frontend `tsc` + `lint` (+ `build` for a final pass).
- Changed `mobile` → mobile `typecheck`.
- Changed `cloudflare` → cloudflare `typecheck`.

## Fix loop
1. Run the relevant check(s).
2. Fix what's clearly fixable: TS type errors, unused imports, bad import paths,
   missing exports, JSX/lint issues.
3. Re-run the failing command to confirm the fix before moving on.
4. Repeat until clean or only genuinely manual follow-up remains.

## Report
- What was checked (which workspaces/commands).
- What errors were found and what you fixed.
- Anything still failing that needs manual attention.

Do not claim the build is clean without showing the command output that proves it.
