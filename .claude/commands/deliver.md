---
description: Hand the Agent Delivery OS a list of work to build autonomously to PRs (intake → preflight → plan → build-until-done).
---

Invoke the `delivery-orchestrator` skill to deliver the following work autonomously to reviewable PRs.

Work to deliver:
$ARGUMENTS

Run the full pipeline: `spec-intake` (→ GitHub issues with observable ACs), `token-preflight`
(RUN/SPLIT/DEFER with the numbers shown), plan into file-disjoint waves, then the `build-until-done`
workflow per wave. Open a PR only when the Definition of Done (`ops/agent-os/dod.md`) passes with
evidence. Report the review queue + anything blocked at the end. Do not ask for approval to proceed
unless a spec ambiguity changes what gets built or the budget can't finish the wave.
