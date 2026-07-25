# Work Queue — parallel agent dispatch

**Generated:** 2026-07-25 · **Base branch:** `feat/phase-engine-schema` (pushed, 6 commits ahead of the last session)

This is the outstanding work, grouped into **file-disjoint tracks** so multiple agents can run
concurrently without colliding. Read "Before dispatching" first — two things will waste a lot of
agent time if skipped.

---

## Before dispatching

### 1. Decide the base branch (blocks everything)

`feat/phase-engine-schema` is ~33 commits ahead of `main` and unmerged. Every track below has to
fork from something, and the choice is not obvious:

- **Fork from `feat/phase-engine-schema`** — agents see current reality, but every branch inherits
  an unmerged 33-commit feature, and merging back to `main` later becomes one enormous diff.
- **Merge the phase-engine branch to `main` first, then fork from `main`** — cleaner history and
  smaller PRs, but blocks all dispatch until that PR is reviewed and merged.

**Recommendation:** merge the phase-engine branch to `main` first. It is functionally complete,
live-proven, and 148 tests pass. Everything downstream gets simpler.

### 2. Resolve the browser-validation gap (blocks all frontend tracks)

Browser-level validation needs the *feature branch* served, but `localhost:3000` serves the main
checkout, so a new UI cannot be exercised live. Until this is decided, frontend agents can write
code but cannot prove it works.

Two options: a transient `pnpm build && start -p <alt>` from the feature worktree, torn down after
validation; or a Vercel preview deploy per branch, with Playwright run against the preview URL
(higher fidelity, matches the deployment target).

**Backend-only tracks (A, G) are unaffected and can start immediately.**

### 3. Known hazard: worktree isolation is not reliable

Previous parallel runs produced units that ran in the MAIN tree (switching `HEAD`) or forked from a
stale commit. After every wave:

```bash
git rev-parse --abbrev-ref HEAD          # expect the base branch
git merge-base <branch> <base>           # expect the base tip, not an old commit
```

Review real diffs from the merge-base, not `base..branch` — the latter is noisy when a branch is
behind.

---

## Tracks

Tracks are file-disjoint from each other. Items *within* a track share files and must run
sequentially.

### Track A — Phase Engine hardening (backend, no UI)

**Owns:** `src/lib/phase-engine/judge/**`, `src/lib/phase-engine/observability.ts`,
`src/app/api/phase-engine/assess/route.ts`
**Can start now** — no browser validation needed.

| # | Item | Notes |
|---|---|---|
| A1 | **[#36](https://github.com/SebastianGarces/everyfield_v2/issues/36) — cron batch throttled by OpenAI TPM** | Five approaches costed in the issue. Cheapest real win is honouring `Retry-After`; the durable fix is header-driven pacing off `x-ratelimit-remaining-tokens`. Live evidence: 1 of 25 plants lost to throttling. |
| A2 | **Capture `cachedInputTokens` on the judge trace** | Same files as A1 — do them together. The rubric is almost certainly being prompt-cached, but nothing measures it, so any pacing budget is guesswork. See the comment on #36. |

### Track B — Wiki

**Owns:** `src/app/(dashboard)/wiki/**`, `src/lib/wiki/**`
Items share files — run **sequentially in this order**.

| # | Item | Risk |
|---|---|---|
| B1 | [#16](https://github.com/SebastianGarces/everyfield_v2/issues/16) — pass real `churchId` so church-scoped articles are reachable | `risk:high` — tenancy. Do first; the others build on correct scoping. |
| B2 | [#15](https://github.com/SebastianGarces/everyfield_v2/issues/15) — related articles + prev/next navigation (W-009) | |
| B3 | [#21](https://github.com/SebastianGarces/everyfield_v2/issues/21) — contextual guide config for meetings & teams routes | Touches meetings/teams *config*, not their code — verify no overlap with Track C before running concurrently. |

### Track C — Meetings

**Owns:** `src/app/(dashboard)/meetings/**`, `src/lib/meetings/**`

| # | Item | Notes |
|---|---|---|
| C1 | [#20](https://github.com/SebastianGarces/everyfield_v2/issues/20) — make `finalizeAttendance` atomic | Reliability NFR. Backend-only; can start before the browser-validation decision. |
| C2 | [#19](https://github.com/SebastianGarces/everyfield_v2/issues/19) — auto-populate team-meeting guest list from roster (VM-006) | Reads ministry-team data — coordinate with Track E. |

### Track D — Communication

**Owns:** `src/app/(dashboard)/communication/**`, `src/lib/communication/**`

| # | Item |
|---|---|
| D1 | [#17](https://github.com/SebastianGarces/everyfield_v2/issues/17) — wire message history filters/search |
| D2 | [#18](https://github.com/SebastianGarces/everyfield_v2/issues/18) — ministry-team roster quick-select for recipients |

### Track E — People & Teams

**Owns:** `src/app/(dashboard)/people/**`, `src/lib/people/**`

| # | Item |
|---|---|
| E1 | [#14](https://github.com/SebastianGarces/everyfield_v2/issues/14) — wire Teams & Training tab to live ministry-team data |

### Track F — Oversight invitations

**Owns:** `src/app/(dashboard)/oversight/invitations/**`

| # | Item | Notes |
|---|---|---|
| F1 | [#23](https://github.com/SebastianGarces/everyfield_v2/issues/23) — wire org-invitations service to a planter-invitation UI | Service exists; this is the UI. **Check for collision** with any agent working on `oversight/health`. |

### Track G — Teams authorization

**Owns:** `src/lib/auth/**` (read), `src/app/(dashboard)/teams/**` write actions

| # | Item | Risk |
|---|---|---|
| G1 | [#22](https://github.com/SebastianGarces/everyfield_v2/issues/22) — enforce role-tier authorization on F8 write actions | `risk:high` — authorization. Warrants two independent verifiers. Backend-only; can start now. |

### Track H — Spec writing (architect agents, docs only)

Fully parallel: each produces one FRD in its own feature folder, zero code, zero file collisions.
Nine `needs-spec` issues: [#24](https://github.com/SebastianGarces/everyfield_v2/issues/24) coaching
workspace · [#25](https://github.com/SebastianGarces/everyfield_v2/issues/25) prayer tracking ·
[#26](https://github.com/SebastianGarces/everyfield_v2/issues/26) public micro-site ·
[#27](https://github.com/SebastianGarces/everyfield_v2/issues/27) Phase-0 toolkit ·
[#28](https://github.com/SebastianGarces/everyfield_v2/issues/28) playbook-grounded empty states ·
[#29](https://github.com/SebastianGarces/everyfield_v2/issues/29) notifications + digest ·
[#30](https://github.com/SebastianGarces/everyfield_v2/issues/30) activation analytics ·
[#31](https://github.com/SebastianGarces/everyfield_v2/issues/31) beta mechanics ·
[#32](https://github.com/SebastianGarces/everyfield_v2/issues/32) migration wizard.
[#33](https://github.com/SebastianGarces/everyfield_v2/issues/33) is an umbrella for 16
medium/long-horizon items — triage before writing.

Follow the existing FRD conventions (see any file under `product-docs/features/*/frd.md`). This is
the highest-leverage track to run in bulk: it is cheap, collision-free, and converts `needs-spec`
into buildable work.

---

## Not delegable — these need you

| Item | Why |
|---|---|
| **Merge decision + PR to `main`** | See "Before dispatching". Gates everything. |
| **Browser-validation strategy** | An architectural call, not a task. Gates all frontend tracks. |
| **Review [PR #34](https://github.com/SebastianGarces/everyfield_v2/pull/34)** (people CSV export) | Open and unreviewed; [#13](https://github.com/SebastianGarces/everyfield_v2/issues/13) sits at `agent:in-review`. Reviewing it closes the first full delivery-loop cycle. |
| **OpenAI zero-data-retention** | Account/org posture. Required before real plant data reaches the judge. |
| **Langfuse** | Needs a self-hosted instance + `LANGFUSE_*` env. Tracing currently no-ops, so judge behaviour is unobservable — worth doing *before* rubric feedback arrives, since traces are how you answer "why did it say that?". |
| **Rubric feedback** | With Brett and Bryan. When it returns, edits go to `product-docs/features/phase-engine/rubric-v0.md` **and** `src/lib/phase-engine/rubric.ts` — the judge reads the second, not the first. Then ship as v1. |
| **Merge `feat/document-templates` and `feat/agent-delivery-os`** | Both unmerged; the delivery loop itself only exists on the latter. |

---

## Done this session (do not re-dispatch)

- `CRON_SECRET` set and verified end-to-end: 401 without/with a wrong token, 200 with the correct
  one, 24 of 25 plants assessed, rollover confirmed.
- Oversight `hasSharedContent` fix — ungated insights no longer suppressed.
- Eval corpus sharing postures seeded (4 full / 4 people-only / 4 none).
- `cleanEvalData` FK repair — reseeds would previously fail once assessments existed.
- Rubric rewritten as a standalone review document; sent to Brett and Bryan.
- Dev account switcher on `/login`, verified absent from production builds.

## Housekeeping

- Stale worktrees: `everyfield_v2-loop-test`, `everyfield_v2-feat-csv`.
- Untracked skill directories (`better-*`, `make-interfaces-feel-better`) + `skills-lock.json` —
  decide whether they belong in the repo.
- One uncommitted two-line prettier reflow in `src/lib/phase-engine/oversight/health-presentation.ts`,
  left alone because another agent was active in that file.
