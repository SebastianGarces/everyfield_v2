---
name: definition-of-done
description: The gate contract that decides whether a unit of work may become a PR. Use when validating a branch/track against acceptance criteria before opening a PR, when an agent claims work is "done", or when building/auditing the build-until-done loop. Produces a structured DoD report (the PR evidence bundle).
---

# Definition of Done

The contract is `ops/agent-os/dod.md` — **read it**. Four gates: CI GREEN, WORKS, REVIEWED, SHIPPED.
This skill is only the report shape the loop routes on and the PR body is built from.

```json
{
  "verdict": "PASS | PASS_WITH_WARNINGS | FAIL",
  "highRisk": false,
  "acceptanceCriteria": [
    { "ac": "<from the issue>", "method": "browser | request | test", "status": "PASS|FAIL", "evidence": "screenshot ref / assertion" }
  ],
  "screenshots": ["<path or MCP ref>"],
  "failingGate": "CI | WORKS | REVIEWED | SHIPPED | publish | delivery",
  "fixInstructions": "<on FAIL: the smallest concrete change(s) that pass the named gate>",
  "summary": "<one paragraph a human reviewer can trust>"
}
```

`failingGate` names one of the four gates; case is not load-bearing. Two values are not gates:
`publish`, the head is not the validated sha, and `delivery`, every gate passed but the PR step
produced no PR. Both are ref operations against work that already passed, so the remedy is to publish
it rather than rebuild it, and neither burns an attempt (`ops/agent-os/dod.md` § Verdict).

A gate with no captured evidence is a FAIL. Do not fix the code while reporting — the sign-off stays
independent.
