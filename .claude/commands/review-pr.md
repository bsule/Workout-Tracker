---
description: Review the current branch's diff against main for bugs and quality.
---

Review the diff from `main` to HEAD. If an argument is given, treat it as the branch or PR
number to review instead: $ARGUMENTS

Read the change with `git diff --stat main...HEAD` then `git diff main...HEAD`. Review it
yourself — don't delegate unless the diff is large enough to span unrelated subsystems, in
which case see the `using-subagents` skill.

## What to check

- **Correctness** — real bugs, data-loss risks, broken edge cases. Weight this highest.
- **Store conventions** (see [CLAUDE.md](../../CLAUDE.md)) — these are the repo's recurring
  footguns, so check them explicitly whenever the diff touches state:
  - a `Snapshot` shape change MUST bump `SCHEMA_VERSION` and add a `migrate()` branch
  - no `await` between a `localApi` mutation and a navigation/commit
  - metric is canonical (kg, `distance_m`); display units convert at the UI boundary only
  - bulk work uses `runBatched()` / `batchMutations()` and calls `flushNow()` after
- **Duplication across clients** — logic added to both `frontend/` and `mobile/` that belongs
  in `packages/core`.
- **Tests** — does a `packages/core` change come with coverage in `tests/`? Client/worker
  changes have no test path, so say what needs manual verification instead.
- **Quality** — naming, error handling, type safety, dead code.

## Verify before reporting

Run the checks that apply to what changed (`npm test` for core; the relevant typecheck/lint
per workspace — see the `check-builds` skill). Report actual output; don't assume it passes.

## Output

**Strengths** — briefly, what's genuinely done well.

**Issues**, grouped Critical / Important / Minor by real severity — don't inflate. For each:
`file:line` — what's wrong — why it matters — how to fix.

**Verdict** — ready to merge: yes / no / with fixes, plus one or two sentences of reasoning.
