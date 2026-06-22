# Agent Delivery OS — operating manual

> **The loop is plumbing. The skill is the asset.**
> One loop, written once (`build-until-done`), filled with sharp, tested, named skills that compound.

This is an autonomous software-delivery environment. **You are the product manager.** You hand the
system a list of work + specs; it turns each item into a GitHub Issue, checks it has the token budget
to finish, runs a verify-until-done loop per task, and **opens a PR only when the Definition of Done
passes with evidence attached.** Your only manual step is reviewing PRs.

---

## How you drive it (as PM)

| You say… | What happens | Skill / workflow |
|----------|--------------|------------------|
| "Build these: …" (a list + specs) | Each item → a rigorous GitHub Issue (`agent:queued`) | `/deliver` → `delivery-orchestrator` → `spec-intake` |
| (implicit, before any build) | "Do we have enough tokens to finish?" → run / split / defer | `token-preflight` |
| (implicit, on run) | Decompose into file-disjoint tracks + dependency waves | `frd-plan` (or inline) |
| (implicit, per track) | Implement → validate against DoD → fix → … → **open PR** | `build-until-done` |
| "What's pending?" | Board by status + your PR review queue + running loops | `/standup` → `standup` |

You never merge by hand-built guesswork: a PR exists **only** because the DoD gate passed, and its
body carries the evidence (test output, screenshots, lighthouse, console, migration diff).

---

## The architecture

```
You (PM): list + specs
        │
        ▼
[spec-intake] ── normalize each item → GitHub Issue            label: agent:queued
        │           (goal, ACs + verification method, risk, file ownership)
        ▼
[token-preflight] ── estimate cost vs remaining budget → run-now / split / defer
        │
        ▼
[frd-plan]* ── file-disjoint tracks + dependency waves         (high-risk → its own wave)
        │
        ▼  per track, in an ISOLATED git worktree:
┌──────────────────  build-until-done.js  (THE LOOP)  ──────────────────┐
│  implement / fix ─→ validate against Definition of Done ─→ PASS?       │
│       ▲                  (independent verifier + MCP)        │         │
│       └────── feed failing gate + evidence back (attempt++) ─┘         │
│  PASS  → [open-pr] with evidence bundle      label: agent:in-review     │
│  EXHAUSTED (max attempts / token reserve) → label agent:blocked,        │
│       comment the failing gate + evidence, alert you.  NO PR, no silent │
│       stop.                                                             │
└────────────────────────────────────────────────────────────────────────┘
        │
        ▼
[standup] ── "what's pending?" → gh issues by status + open PRs + running loops
```
\* `frd-plan` for FRD-scale features; the orchestrator decomposes ad-hoc lists inline with the same
file-disjoint/track logic.

---

## The two halves (per the thesis)

- **The loop (plumbing):** `build-until-done.js`. Written once. It does not contain product knowledge —
  it orchestrates: spawn implementer → spawn independent verifier → branch on the verdict → retry or
  ship → trip a circuit breaker if it can't converge.
- **The skills (assets):** the named, reusable knowledge the loop calls — `definition-of-done`,
  `validate-frontend`, `validate-backend`, `open-pr`, `spec-intake`, `token-preflight`, `standup`.
  When we do something hard or more than once, it becomes a new skill, and the loop gets sharper for free.

---

## Definition of Done

The contract lives in [`dod.md`](./dod.md). Summary: G0 spec-mapped · G1 static (typecheck/lint/build)
· G2 tests · **G3 functional via MCP** (Playwright drives `localhost:3000`, asserts each AC, requires a
clean console + screenshots + lighthouse a11y ≥ 90; backend asserts contracts + migration) · G4
conventions/invariants · G5 diff hygiene · G6 independent adversarial sign-off. High-risk adds migration
dry-run, rollback, schema diff, and a second verifier.

## The board

GitHub Issues + `agent:*` status labels. See [`labels.md`](./labels.md). Run the setup block there once
to create the labels.

---

## Safety / circuit breakers

- **Max attempts** per track (default 3) — the loop will not iterate forever.
- **Token reserve** — the loop refuses to *start* an attempt it can't finish; `token-preflight` gates
  the whole wave up front. A task that can't finish is **deferred or split**, never half-shipped.
- **No silent stops** — exhaustion always produces an `agent:blocked` issue with the reason.
- **High-risk → PR, not merge** — the human PR review is the checkpoint for schema/auth/tenancy/payments.
- **Dev server** — G3 needs `localhost:3000` up. Per `AGENTS.md` the loop never starts one; it checks
  and asks you if it's down.

## Where this lives

Branch `feat/agent-delivery-os` in the worktree `everyfield_v2-agent-os`. Merge to `main` once you're
happy with it, and every session/agent inherits the skills.
