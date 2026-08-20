---
description: Hand a list of work to the agent to build autonomously to PRs (spec-intake → issues → build per ops/process.md).
---

Deliver the following work autonomously to PRs. How we work: `ops/process.md` — read it first.

Work to deliver:
$ARGUMENTS

## The pipeline

1. **Intake → issues.** Run `spec-intake` **once over the whole list**, not once per item. Each issue
   gets observable acceptance criteria, a validation plan, and a file-ownership guess, labelled
   `agent:queued`. Ask the user a question only when an ambiguity changes *what gets built*;
   otherwise rule it, default, and note the ruling in the issue.

2. **Write the blocking edges.** A dependency is semantic: `gh issue edit <n> --add-blocked-by <m>`.
   Create the blockers first so each edge can name a real number. File overlap is scheduling, not a
   dependency — it belongs in `## Likely files`.

3. **Build it.** Run the work per `ops/process.md` — directly, or through the `dispatch` skill for an
   unattended pass. Merging a PR closes its issue, clears its edges, and moves whatever it blocked
   onto the frontier: re-query and go again until the list is done.

4. **Report.** PRs opened, anything that failed with what failed, and what is still queued.
   `/standup` gives the live board anytime.

Do not ask for approval to proceed unless a spec ambiguity changes what gets built. Rule it, record
the ruling (product rulings in `product-docs/decisions.md`, code rulings in the PR body), and keep
going. CI green is the merge bar: enable auto-merge and move on.
