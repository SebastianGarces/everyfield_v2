---
description: Hand the Agent Delivery OS a list of work to build autonomously to PRs (intake → preflight → plan → build-until-done).
---

Read `.claude/skills/delivery-orchestrator/SKILL.md` and follow it as your procedure, to deliver the
following work autonomously to reviewable PRs.

> Read the file — do not invoke it with the Skill tool. `delivery-orchestrator` is user-invoked
> (`disable-model-invocation: true`) so the model can never start the factory on its own; this
> command is the human's trigger. See `ops/agent-os/invocation.md`.

Work to deliver:
$ARGUMENTS

Run the full pipeline: `spec-intake` (→ GitHub issues with observable ACs), `token-preflight`
(RUN/SPLIT/DEFER with the numbers shown), then build **the frontier** — every queued issue with zero
open blockers and no assignee (`ops/agent-os/labels.md`) — with the `build-until-done` workflow. Open a
PR only when the Definition of Done (`ops/agent-os/dod.md`) passes with evidence. Merging a PR closes
its issue, which clears that issue's edges and moves whatever it blocked onto the frontier; re-query and
go again. Report the review queue + anything blocked at the end. Do not ask for approval to proceed
unless a spec ambiguity changes what gets built or the budget can't finish the batch.
