---
name: deliver
description: Hand a list of work to the agent to build autonomously to PRs (spec-intake → issues → build per ops/process.md). Use when the user says “deliver” and provides one or more pieces of work to ship.
---

# Deliver work autonomously

Read `ops/process.md` first. Treat the user's requested work as the input to this pipeline.

## The pipeline

1. **Intake → issues.** Run `spec-intake` once over the whole list, not once per item. Each issue
   gets observable acceptance criteria, a validation plan, and a file-ownership guess, labelled
   `agent:queued`. Ask the user only when an ambiguity changes what gets built; otherwise rule it,
   default it, and note the ruling in the issue.
2. **Write the blocking edges.** A dependency is semantic:
   `gh issue edit <n> --add-blocked-by <m>`. Create blockers first so each edge can name a real
   number. File overlap is scheduling, not a dependency; put it in `## Likely files`.
3. **Build it.** Run the work per `ops/process.md`, directly or through `dispatch` for an unattended
   pass. Merging a PR closes its issue, clears its edges, and moves whatever it blocked onto the
   frontier. Re-query until the requested list is done.
4. **Report.** Name PRs opened, anything that failed and why, and what remains queued. The `standup`
   skill gives the live board at any time.

Do not ask for approval to proceed unless a spec ambiguity changes what gets built. Rule it and
record the ruling (`product-docs/decisions.md` for product rulings, the PR body for code rulings),
then keep moving. CI green is the merge bar.
