---
name: definition-of-done
description: The gate contract that decides whether a unit of work may become a PR. Use when validating a branch/track against acceptance criteria before opening a PR, when an agent claims work is "done", or when building/auditing the build-until-done loop. Produces a structured DoD report (the PR evidence bundle).
---

# Definition of Done

The canonical gate list is `ops/agent-os/dod.md` — **read it first**; this skill is how an agent
*runs* it and emits the evidence bundle.

## When to use

- An implementer claims a track is finished and you must decide PASS / RETRY / BLOCK.
- You are the independent verifier inside `build-until-done`.
- You need the evidence object that becomes the PR body.

## How to run the gates

Work the gates in order; **stop early on the first hard failure** that the implementer must fix
(don't waste tokens validating downstream of a broken build). Capture evidence for every gate you run.

1. **G0 Spec mapped** — read the source Issue; build the AC → method table. If any AC is unverifiable, that's a FAIL (the spec is the problem — kick back to `spec-intake`).
2. **G1 Static** — run in the track's worktree:
   ```bash
   pnpm typecheck && pnpm lint && pnpm build
   ```
3. **G2 Tests** — `pnpm test`. Grep the diff for `.only(` / `.skip(`.
4. **G3 Functional** — delegate to `validate-frontend` (frontend/fullstack) or `validate-backend` (backend/API). This is the load-bearing gate: it proves the thing actually works.
5. **G4 Conventions** — grep the diff: clickables have `cursor-pointer`; no `db:push`; new shadcn via CLI; `memory/*` updated if contracts/flows/entrypoints/invariants moved.
6. **G5 Diff hygiene** — `git diff --stat` vs the declared file list; scan for secrets/debug/dead code.
7. **G6 Independent sign-off** — this gate is satisfied by the verifier being a *separate* agent from the implementer. Default to reject when evidence is thin.

**High-risk** (schema/auth/tenancy/payments): additionally run HR1–HR4 from `dod.md` (migration dry-run + schema diff, rollback proof, two verifiers).

## Output — the DoD report (the evidence bundle)

Return exactly this shape. It is both the loop's decision signal and the PR body source.

```json
{
  "verdict": "PASS | PASS_WITH_WARNINGS | FAIL",
  "highRisk": false,
  "gates": [
    { "id": "G1", "status": "PASS|FAIL|SKIPPED", "evidence": "tsc 0 errors; lint 0; build ok" }
  ],
  "acceptanceCriteria": [
    { "ac": "<text from the issue>", "method": "G3 playwright", "status": "PASS|FAIL", "evidence": "screenshot ref / assertion" }
  ],
  "screenshots": ["<path or MCP ref>"],
  "failingGate": "G3",
  "fixInstructions": "<for the implementer, on FAIL: the smallest concrete change(s) to pass>",
  "summary": "<one paragraph a human reviewer can trust>"
}
```

## Rules

- **No PASS, no PR.** `FAIL` → the loop feeds `failingGate` + `fixInstructions` back and retries.
- **Evidence or it didn't happen.** A gate with no captured output is treated as FAIL.
- **Adversarial by default.** You are trying to *reject*; a green build is necessary, not sufficient — G3 must actually demonstrate the ACs.
- **Don't fix the code.** The verifier validates and reports; the implementer fixes. (Keeps the sign-off independent.)
