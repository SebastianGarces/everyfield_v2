---
description: Hand the Agent Delivery OS a list of work to build autonomously to PRs (intake → plan → build-until-done).
---

Deliver the following work autonomously to reviewable PRs. Operating manual:
`ops/agent-os/README.md`. Definition of Done: `ops/agent-os/dod.md`.

Work to deliver:
$ARGUMENTS

## The pipeline

1. **Intake → issues.** Run `spec-intake` **once over the whole list**, not once per item. Each
   issue gets observable acceptance criteria, a risk class, and a file-ownership guess, labelled
   `agent:queued` (+ `risk:high`). Ask the user a question only when an ambiguity changes *what gets
   built*; otherwise rule it, default, and note the ruling in the issue.

2. **Plan onto the board.** An FRD-scale feature → run `frd-plan`, which publishes file-disjoint
   tracks as issues with native `blocked_by` edges. An ad-hoc list → group the issues yourself and
   write the semantic dependencies as edges: `gh issue edit <n> --add-blocked-by <m>`. Shared files
   versus blocking edges are defined once in `ops/agent-os/labels.md` — read it there.

3. **Build the frontier.** Take every queued issue with zero open blockers and no assignee (the
   frontier query lives in `ops/agent-os/labels.md`) and run the `build-until-done` workflow on it.
   A PR opens only when the DoD passes with evidence: CI green, one code review, and one browser
   look for UI. Merging a PR closes its issue, clears its edges, and moves whatever it blocked onto
   the frontier — re-query and go again. Do not start a batch you cannot finish.

4. **Report.** PRs opened (the review queue), anything blocked with its failing gate, and what is
   still queued. `/standup` gives the live board anytime.

Do not ask for approval to proceed unless a spec ambiguity changes what gets built. High-risk work
still ships to a PR; it never auto-merges.
