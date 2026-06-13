---
description: Review the current branch's diff against main for bugs and quality.
---

Review the diff from `main` to HEAD. Dispatch the `code-reviewer` subagent with the
range `main..HEAD`. Summarize its Critical/Important findings and give a merge verdict.

If an argument is given, treat it as a PR number or branch to review instead: $ARGUMENTS
