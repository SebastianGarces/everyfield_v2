# Definition of Done (DoD)

This is the **single source of truth** for when a unit of work is allowed to become a PR.
Every skill and workflow in the Agent Delivery OS cites this file. A unit is **DONE** only when
**every applicable gate passes with captured evidence**. No PASS → no PR. The loop
(`build-until-done`) keeps iterating until DONE or a circuit breaker trips.

The evidence collected here becomes the **"Definition of Done ✅"** section of the PR body, so a
human reviewer can confirm each claim without re-running anything.

---

## Gates

### G0 — Spec mapped
- Every acceptance criterion (AC) on the source GitHub Issue has a declared **verification method**
  (which gate proves it, and how).
- No AC is left unverifiable ("looks good" is not a method).
- **Evidence:** AC → method table.

### G1 — Static checks
- `pnpm typecheck` → clean (0 errors).
- `pnpm lint` → clean (0 errors; warnings noted).
- `pnpm build` → succeeds.
- **Evidence:** the tail of each command + exit code.

### G2 — Tests
- `pnpm test` → green.
- New/changed logic has tests (happy path + at least one failure/edge path).
- No `.only`, no `.skip`, no commented-out tests.
- **Evidence:** test summary (counts) + exit code.

### G3 — Functional validation (the proof — MCP-driven)
The unit must be demonstrated **working against the running app**, not just compiling.

**Frontend / fullstack units** → run the `validate-frontend` skill:
- Drive the already-running dev server at `http://localhost:3000` with the **Playwright MCP**.
- For each AC: navigate to the flow, perform the interaction, and assert the visible outcome
  (`browser_snapshot` / `browser_click` / `browser_evaluate`).
- `browser_console_messages` must contain **no errors** (warnings noted).
- Capture a **screenshot** of each key state.
- Run a **chrome-devtools `lighthouse_audit`** on the touched page; **accessibility ≥ 90**
  (perf/best-practices recorded, not blocking unless the AC says so).
- **Evidence:** per-AC pass/fail, screenshot refs, console dump, lighthouse summary.

**Backend / API units** → run the `validate-backend` skill:
- Exercise the route / server action (curl or a `tsx` harness) and assert response **status + shape**
  against the contract in `memory/contracts/api.md`.
- `pnpm db:migrate` applies cleanly on a scratch/shadow DB.
- **Evidence:** request/response transcript, migration output.

### G4 — Conventions & invariants
- `cursor-pointer` on every clickable (per `AGENTS.md`).
- New shadcn components added via `pnpm dlx shadcn@latest add` (never hand-written).
- Migrations via `pnpm db:migrate` — **never** `db:push`.
- `memory/*` updated **in the same change** if entrypoints, flows, contracts, or invariants moved
  (per `.agents/memory-first.md` and `memory/invariants.md`).
- Tenancy / auth boundaries respected (`memory/invariants.md`).
- **Evidence:** checklist with the specific lines/files touched.

### G5 — Diff hygiene
- Changes confined to the unit's declared files; any deviation is named and justified.
- Conventional commit messages.
- No debug logs, no commented dead code, no secrets/keys, no `.env` edits.
- **Evidence:** `git diff --stat` + a one-line deviation note (or "none").

### G6 — Independent sign-off
- A **separate** `code-reviewer` agent (NOT the implementer) confirms G1–G5 **from the evidence,
  adversarially** — default to reject when a gate's evidence is missing or unconvincing.
- Verdict ∈ `PASS` | `PASS_WITH_WARNINGS` | `FAIL`. Only `PASS` / `PASS_WITH_WARNINGS` may open a PR.
- **Evidence:** reviewer verdict + findings.

---

## High-risk units (extra gates)

A unit is **high-risk** if it touches: DB schema/migrations, auth/permissions/roles, multi-tenant
boundaries, or payments/billing. These are **still autonomous to PR** (the PR review is the human
checkpoint), but they must additionally satisfy:

- **HR1 Migration dry-run** — migration applied to a scratch DB and the resulting schema diff captured.
- **HR2 Rollback verified** — down-migration (or documented rollback) proven to restore prior state.
- **HR3 Schema diff in PR body** — the exact DDL delta is shown to the reviewer.
- **HR4 Two independent verifiers** — two separate `code-reviewer` passes must both reach PASS;
  any FAIL blocks.
- The PR is labelled `risk:high` so it sorts to the top of the review queue.

---

## Verdict

```
DONE  = G0..G6 all PASS  (+ HR1..HR4 if high-risk)
        → open PR, attach evidence, label issue `agent:in-review`
NOT DONE
        → feed failing gate + evidence back to the implementer, retry (attempt++)
EXHAUSTED (max attempts or token reserve hit)
        → DO NOT open a PR; label issue `agent:blocked`, comment the failing gate + evidence,
          alert the human. Never stop silently.
```
