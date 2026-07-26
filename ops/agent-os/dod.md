# Definition of Done (DoD)

This is the **single source of truth** for when a unit of work is allowed to become a PR.
Every skill and workflow in the Agent Delivery OS cites this file. A unit is **DONE** only when
**every applicable gate passes with captured evidence**. No PASS → no PR. The loop
(`build-until-done`) keeps iterating until DONE or a circuit breaker trips.

The evidence collected here becomes the **"Definition of Done ✅"** section of the PR body, so a
human reviewer can confirm each claim without re-running anything.

---

## Anchored vs attested — read this before trusting any gate below

Every gate is one of two kinds, and the difference decides how much you have to supervise:

- **Anchored** — something that cannot argue back said so. A check run's conclusion. A test exit
  code. An HTTP response from a deployment that actually contains this branch's code.
- **Attested** — an agent says so, and its evidence is its own prose.

An attested gate is not worthless, but it fails in a specific way: it stays green while the thing
it describes quietly stops being true. This repo has three worked examples. A DoD reported PASS
with a browser gate that had never opened a browser. CI was believed to be validating PRs while it
had not passed once since April. G3 drove `localhost:3000`, which serves `main`, so it exercised
code the branch had never written.

> Topology does not buy truth. Anchors do.

| Gate | Kind | What anchors it |
|---|---|---|
| G0 Spec mapped | attested | — judgment, inherently |
| G1 Static | **anchored** | the `Format, Lint, Typecheck, Build` check on the PR |
| G2 Tests | **anchored** | `pnpm test` runs in that same check |
| G3 Functional | partly anchored | a real preview deployment containing this branch; assertions are still attested |
| G4 Conventions | attested | — |
| G5 Diff hygiene | **computed** | `git diff --name-only` compared against the declared file set |
| G6 Independent sign-off | attested | fresh-context reviewer; judgment by design |

**The rule that follows:** a passing DoD report is a claim, and the PR's required check is the
verdict. `open-pr` waits for it, and the loop treats *green DoD + red check* as a failed attempt.

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
- `pnpm format:check` → clean.
- `pnpm build` → succeeds. Run it the way CI does — **hermetic**, no reachable database:
  ```bash
  CI=1 DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" \
    RESEND_API_KEY="re_ci_placeholder" pnpm build
  ```
  A build that only succeeds against a live database will pass locally and fail in CI.
- **Evidence:** the tail of each command + exit code — *and* the PR check, which is the anchor.
  Running these locally is how you avoid a red check; it is not what proves the gate.

### G2 — Tests
- `pnpm test` → green.
- New/changed logic has tests (happy path + at least one failure/edge path).
- No `.only`, no `.skip`, no commented-out tests.
- **Anchored:** CI runs the suite too, so a number reported here that CI cannot reproduce fails the
  PR. If a test only passes with your `.env.local`, it does not pass.
- A pre-existing failure is not a free pass. Say which test, and prove it fails on `main` as well —
  otherwise you are shipping on the assumption that someone else broke it.
- **Evidence:** test summary (counts) + exit code.

### G3 — Functional validation (the proof — MCP-driven)
The unit must be demonstrated **working against the running app**, not just compiling.

**Frontend / fullstack units** → run the `validate-frontend` skill:
- Drive the branch's **Vercel preview deployment**, not `localhost:3000`. Localhost serves the
  **main checkout**, so it never contains the track's work — validating there proves nothing about
  the change and is how a UI gate passes without anything being exercised.
  Get the URL with `./scripts/preview-url.sh --wait --bypass <pr-number>`; the full procedure and
  its two traps are in `.claude/skills/browser-validation/SKILL.md`.
- **Consequence for the loop:** the preview is created by the push, so a frontend track opens its PR
  with G3 at ⏳, validates against the preview, then edits the PR body to ✅. A PR may exist briefly
  unvalidated; it may never *claim* a gate it did not run.
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
- **Compute the file list, do not recall it.** Run it and compare against the declared set:
  ```bash
  git diff --name-only $(git merge-base origin/main HEAD)...HEAD
  ```
  Anything in that output and not in the unit's declared files is a deviation, whether or not it
  felt significant while writing it. "I stayed in scope" is a memory; this command is a fact.
- **Evidence:** the raw command output, plus `git diff --stat` and a one-line deviation note
  (or "none").

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
- **HR4 Diverse-lens sign-off** — after G6, three *independent* reviewers each examine the branch
  through **one** lens, and **every one must clear**. Any FAIL blocks; a lens whose agent dies also
  blocks, because missing evidence is a FAIL everywhere else in this document.

  | Lens | The question it owns |
  |---|---|
  | `correctness` | Does it do what the ACs asked, including the edge cases nobody wrote an AC for? Is the DDL itself right, and does existing data survive it? |
  | `security` | Auth on every new entrypoint, multi-tenant boundaries, injection, secrets or internal data leaking to a client bundle or log. Holds `memory/invariants.md` as hard requirements. |
  | `reproducibility` | Re-runs the migration dry-run, the rollback, and `pnpm test`, and re-derives the schema diff — then checks the first verifier's claims against what it actually observed. |

  This replaced *two identical `code-reviewer` passes*. Two identical reviewers largely reproduce
  each other's blind spots — the second agrees with the first for the same reasons the first was
  wrong. Three different questions don't correlate that way.

  **The votes are not pooled, and that is the point.** Majority voting is the correct aggregation
  for *redundant* verifiers, where identical skeptics generate correlated noise and outvoting
  filters it. These verifiers are *diverse*: a `security` FAIL is not noise the other two can
  outvote, because neither of them looked at security. Each lens holds a veto over its own axis.

  Findings from lenses that **do** clear are carried into the PR body, so the human reviewer can see
  what each axis actually examined rather than just that it passed.
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
