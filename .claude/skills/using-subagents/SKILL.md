---
name: using-subagents
description: Use when deciding whether to delegate work to a subagent instead of doing it in the main session — broad searches, independent parallel tasks, or work that would flood the main context. Explains when delegation pays off, when it doesn't, and how to write a prompt that comes back useful.
---

# Using Subagents

## Overview

You can dispatch subagents whenever you judge it worthwhile. This is a **judgment call, not a
procedure** — there is no rule that says "N failures means N agents." Delegate when it actually buys
you something, and do the work yourself when it doesn't.

A subagent buys you exactly two things:

1. **Context isolation** — it burns its own context reading files, and returns only a conclusion.
   Your main thread keeps its context for the work that needs continuity.
2. **Parallelism** — independent tasks run concurrently instead of one after another.

It costs you: the agent can't see this conversation, it re-derives things you already know, its
report is a summary you have to trust, and you pay latency even for trivial work. **If neither
benefit applies, do it inline.**

## Core principle

**Delegate the search, keep the decision.** Subagents are excellent at "go read a lot and tell me
what you found." They are poor substitutes for your own judgment about what to change and why.

## When it pays off

### Broad search where you only want the conclusion
You need to know *where* something lives across many files, not read all of them.

> "Find every place the mobile client reads `settings.weight_unit` directly instead of going
> through `fromKg`/`formatWeight`. Return a list of `file:line` with the surrounding call."

Use `Explore` for this. Sweeping `frontend/`, `mobile/`, and `packages/core/` yourself would dump
dozens of files into context to produce a ten-line answer.

### Genuinely independent tasks, in parallel
Different subsystems, no shared state, no ordering between them. In this repo the natural fault
lines are **`packages/core` / `frontend` / `mobile` / `cloudflare`**.

> Agent 1: "In `frontend/`, update the exercise picker to show the position-PR badge."
> Agent 2: "In `mobile/src/`, do the same for `ExercisePickerSheet`."

Dispatch these in one message so they run concurrently. Note the caveat below about shared files.

### Understanding a subsystem before you touch it
Use `explainer` for "how does X work" — it returns a map of the flow without you reading the whole
subtree. The architectural conventions are already in [CLAUDE.md](../../../CLAUDE.md), which is
loaded every session; don't spend an agent re-deriving them.

### An independent pass over work that's already done
Use `spec-verifier` to check an implementation against what was actually asked, or
`security-reviewer` before shipping worker/auth changes. The value here is the **fresh perspective** —
an agent that hasn't been staring at the code is better at noticing what's missing than you are.

## When to just do it yourself

- **You already know the file.** A single-fact lookup or a one-line edit is faster inline.
- **The tasks aren't actually independent.** If fixing one might fix the others, investigate
  together first — parallel agents will duplicate work and reach conflicting conclusions.
- **You're still exploring.** If you don't yet know what's broken, you can't write a scoped prompt.
  Narrow it down yourself, *then* delegate the parts that turn out to be separable.
- **The work needs conversation context.** Anything depending on a decision made earlier in this
  session, or on the user's stated preference, is hard to hand off — the agent starts blind.
- **The change is small.** Delegation overhead exceeds the work.

## Repo-specific cautions

- **Don't put two agents in the same file.** `frontend/` and `mobile/` are safely parallel;
  two agents both editing `packages/core/src/store/mutations.ts` will clobber each other. If they
  must touch the same file, run them sequentially or use worktree isolation.
- **A change to `packages/core` is not parallelizable with its consumers.** Both clients import it —
  land the core change first, then fan out to `frontend` and `mobile`.
- **Tell the agent the conventions it will otherwise break.** It has not read this conversation. If
  the task touches the store, say so explicitly: never `await` between a `localApi` mutation and a
  navigation, bump `SCHEMA_VERSION` + add a `migrate()` branch for shape changes, metric is
  canonical. See [CLAUDE.md](../../../CLAUDE.md).

## Writing a prompt that comes back useful

The agent starts with **no memory of this conversation**. Everything it needs must be in the prompt.

1. **Scope** — the specific files, directory, or subsystem. Not "the codebase."
2. **Goal** — what "done" looks like, concretely.
3. **Constraints** — what it must not touch. Agents over-reach by default.
4. **Return format** — say what you want back, or you'll get prose you have to re-read.

```
Scope: mobile/src/screens/SetLoggerScreen.tsx only.

Goal: the rest-timer ticker re-renders the whole set list every second. Make only the
timer text re-render.

Constraints: do NOT change anything in packages/core. Do NOT change the timer's
duration logic — only what re-renders. No new dependencies.

Return: the root cause in 2 sentences, then the diff you applied, then the result of
`cd mobile && npm run typecheck`.
```

Compare to what not to send: *"Fix the slow set logger."* — no scope, no constraints, no idea what
comes back.

## After they return

Agent reports are **claims, not verified facts**. Before building on one:

- Read each summary; don't skim to the conclusion.
- **Check for conflicts** if any two agents could have touched the same file.
- **Run the real checks yourself** — `npm test` for core, the relevant typecheck per workspace (see
  the `check-builds` skill). An agent saying "tests pass" is not the same as tests passing.
- Spot-check at least one specific claim against the actual code. Agents make systematic errors, and
  a confidently-wrong report is worse than no report.

If an agent's finding contradicts something you established earlier in the session, trust your own
context first and re-verify — the agent didn't have it.

## Red flags — stop

- Dispatching an agent because the task *feels* big, without being able to state its scope in one
  sentence.
- Two agents whose file sets overlap.
- Accepting "done, all tests pass" without running the tests.
- Delegating the decision about *what the right design is* — that's yours.
