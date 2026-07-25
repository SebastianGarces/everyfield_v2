# Work Queue — parallel agent dispatch

**Updated:** 2026-07-25 (second pass) · **Base branch:** `main` — now the repo's default branch and
the only remote branch. Fork everything from `main`.

This is the outstanding work, grouped into **file-disjoint tracks** so multiple agents can run
concurrently without colliding.

**Both dispatch gates are now clear.** CI passes and is required on `main`; browser validation runs
against Vercel previews and has been proven end to end. All seven tracks are runnable — §1 and §2
below are now context to preserve, not blockers to resolve.

---

## Before dispatching

### 1. CI is green — keep the build hermetic

[#38](https://github.com/SebastianGarces/everyfield_v2/issues/38) is **fixed**.
`pull-request-checks.yml` had never passed since it was added in April. Three causes, all now
resolved: two module-scope client constructions (placeholder `DATABASE_URL` and `RESEND_API_KEY` in
the workflow env, fixed while merging #37), and `/wiki/[...slug]` querying the database during
page-data collection. The third was a `generateStaticParams` on a route that already declares
`dynamic = "force-dynamic"` — it prerendered nothing and only forced a build-time DB round-trip, so
it was removed rather than made fail-soft. No prerendering was lost; the route was already `ƒ`.

**The invariant to preserve:** `pnpm build` must succeed with no reachable database and no real
credentials. That means no `generateStaticParams`, `sitemap.ts`, or other build-time hook may
depend on a live query, and module-scope client construction needs a placeholder-tolerant path.
Verify a change locally the way CI sees it:

```bash
CI=1 DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" RESEND_API_KEY="re_ci_placeholder" pnpm build
```

Next 16's `isolatedDevBuild` writes `next dev` output to `.next/dev`, so this is safe to run while
the dev server is up.

**Enforcement:** the check is now required on `main` via the `main protection` ruleset (#19738586),
which also requires a PR. It runs on **every** PR regardless of base — a PR against a stray base
used to run no check at all, which reads as "not yet run" rather than failing, and hid a PR for a
month.

**The check now genuinely binds.** The repository-admin bypass has been removed, so a red check
stops a merge for everyone including you. Verified: `GET /rules/branches/main` returns both rules
(it returned `[]` while the bypass was active, which is how the earlier misconfiguration was
caught), and a direct push to `main` is rejected with "Changes must be made through a pull request."

The escape hatch is no longer a flag — it is setting the ruleset to Disabled or Evaluate in
**Settings → Rules**, which is deliberate and leaves a trace. Editing the ruleset via the API needs
the **full** payload; `PUT` replaces the object, so sending a single field would drop the rules and
conditions along with it.

### 2. Browser validation — decided: Vercel previews

**Decision: validate on the branch's Vercel preview deployment**, not a transient local server. The
deciding fact is that the preview half already exists — every PR to `main` gets a preview deploy
(visible as the passing `Vercel` check on any PR), so there was nothing to build there, only to
reach. It also matches the deployment target, which a `pnpm start -p 3001` from a worktree does not.

Procedure lives in `.claude/skills/browser-validation/SKILL.md`. In short:

```bash
./scripts/preview-url.sh --wait --bypass <pr-number>   # first navigation
```

Two things make this work, both worth understanding before changing anything near them:

- **Deployment protection stays on.** Previews are behind Vercel Authentication and point at the
  development database, which holds real people's data — leaving them public is not an option. The
  sanctioned way through is Protection Bypass for Automation: a project secret passed as
  `x-vercel-protection-bypass`, with `x-vercel-set-bypass-cookie=true` so one navigation authorizes
  the whole browser session. Set `VERCEL_AUTOMATION_BYPASS_SECRET` in `.env.local`.
- **The dev account switcher is absent on previews and must stay absent.** It is gated on
  `NODE_ENV === "development" && !process.env.VERCEL`, enforced in three places, and Vercel builds
  are production builds. Agents log in through the real form with a seeded account
  (`planter1@everyfield.dev` / `password123`) against the shared development database.

**Consequence for the tracks:** B, D, E and F are unblocked. Validation now happens *after* the PR
is opened — the preview is created by the push — so a UI PR opens with its browser gate at ⏳ and
gets edited to ✅ once exercised.

**Proven, not theoretical.** The bypass secret is generated and in `.env.local`, and the flow closed
a real gate: the CSV export PR ([#41](https://github.com/SebastianGarces/everyfield_v2/pull/41)) had
its Export button exercised on its own preview — 100 rows against a UI reading `100 total`, 3 rows
under a status filter reading `3 total`, and zero overlap between two churches' exports. Two traps
the skill records so nobody re-discovers them: `planter1@everyfield.dev`'s church has **zero
people** (use an eval planter, different password), and previews log one `403` per page load from a
Vercel toolbar `HEAD` request that is not the app.

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

## Go-live: Phase Engine

What stands between "merged" and "a real planter can use it". Ordered.

### 1. Understand the Neon branch model before touching prod

**Neon branches are effectively separate databases.** A branch is an instant copy-on-write clone
with its own compute endpoint and its own connection string. After creation the two diverge
completely: writes to `development` never reach `production`, and — critically — **migrations are
per-branch**. Running `pnpm db:migrate` against the development branch does nothing to production.

That is exactly what the current state shows. The production branch has 0 migrations applied, no
phase-engine tables, no pgvector, and 0 churches, while development has the full schema and the eval
corpus. The branches were never in sync for this feature.

**CLI gotcha, already hit:** `neon projects list` returns "You don't have any projects yet" even
though the dashboard shows three. The projects belong to an **organization**, and the bare command
scopes to your personal account, which really is empty. Always pass `--org-id`, or link once:

```bash
neon orgs list                                        # org-hidden-bar-40434795 = "Vercel: Sebastian Garces' projects"
neon projects list --org-id org-hidden-bar-40434795
neon link --org-id org-hidden-bar-40434795 --project-id twilight-mountain-40922471
```

EveryField's identifiers:

| | |
|---|---|
| Project | `twilight-mountain-40922471` (org `org-hidden-bar-40434795`) |
| `development` branch | `br-autumn-mud-ah4urw7t` — created 2026-01-26, has the full schema |
| `production` branch | `br-fragrant-tooth-ahkv7yv4` — created 2026-04-07, **is the default branch** |

The command that answers "what is production missing":

```bash
neon branches schema-diff production development --project-id twilight-mountain-40922471
```

**What it currently reports: production is ~4 months stale and missing far more than the phase
engine.** It was branched from development on 2026-04-07 and has received no migrations since.
Absent there: `plant_assessments`, `plant_insights`, `plant_signals`, `phase_transitions`,
`insight_feedback`, `methodology_embeddings`, the `vector` extension, **`auth_attempts`** (login
rate limiting), and the `assistant_*` tables. Provisioning it is not a phase-engine task — it is a
full catch-up.

**Practical rule going forward:** every migration must be applied to each branch you care about.
Whatever branch you eventually treat as production needs its own `db:migrate` run, and a habit (or a
deploy step) that keeps it current.

### 2. Provision whichever database becomes production

When the switch happens, that database needs, in order:

```bash
# 1. schema — includes CREATE EXTENSION vector in migration 0021
pnpm db:migrate

# 2. methodology corpus — ~572 chunks, ~$0.004
pnpm exec tsx scripts/embed-methodology-corpus.ts
```

Skipping the second step does not break anything visibly: assessments still generate, but RAG
returns nothing and every insight loses its wiki citation. The grounding is half the value, so this
is not optional.

Confirm pgvector is available on the target before migrating — `0021` opens with
`CREATE EXTENSION IF NOT EXISTS vector` and will fail partway if the extension is not permitted.

### 3. Database hosting is an open decision

Neon suits development well; the production posture is undecided, and the branch model above is one
reason to think it through rather than default into it. **Decision trigger: the point Bryan and
Brett start bringing real test users.** That is when a database stops being disposable and starts
being something with an availability and backup story.

Until then `DATABASE_URL` in Vercel deliberately points at the **development** branch — the goal
right now is proving deployment works, not preserving data, and being able to wipe the DB freely is
worth more than durability. Two consequences worth remembering while that holds:

- The deployed cron runs against development data, so scheduled assessments will re-assess the eval
  corpus and cost real OpenAI credit on a daily schedule.
- Both the local and deployed apps write to the same database.

### 4. OpenAI data posture (supersedes "confirm zero data retention")

**True ZDR is not self-serve.** It requires OpenAI approval via sales, is configured at the project
level once granted, and is aimed at enterprise accounts. It is unlikely to be available pre-revenue,
so treating the requirement as "turn on ZDR" leaves it permanently unmet.

What is true by default, and may well be sufficient for a small beta:

| | |
|---|---|
| Training on API data | **No** — API data is not used to train models unless you explicitly opt in |
| Abuse-monitoring retention | **Up to 30 days** by default |
| Stored completions | Off unless `store` is set |

Self-serve, do this now: **Settings → Organization → Data controls → Data Retention**, set at the
project level.

Requires contacting sales (`openai.com/contact-sales`): Zero Data Retention, Modified Abuse
Monitoring, Data Residency, Enterprise Key Management.

**Recommended path:** configure the self-serve retention control, write the actual posture down, and
disclose it to Bryan, Brett, and any test user whose plant data goes through the judge — real people
in a real church are in that data. Pursue ZDR when there is a contract to hang it on.

**Amend the FRD.** The non-functional requirement currently reads "use a provider/configuration with
zero data retention". As written it cannot be satisfied, so it should be restated as: document the
provider's data handling, enable the strongest self-serve controls, disclose to users, and escalate
to ZDR when eligible.

### 5. Verify the deployed cron fires

Schedule is `0 7 * * *` (07:00 UTC daily). After the first deploy, confirm an actual invocation — a
route that works locally and a cron that fires in production are different claims.

---

## Not delegable — these need you

| Item | Why |
|---|---|
| **OpenAI data posture** | See Go-live §4. Self-serve retention control now; ZDR needs sales and is likely out of reach pre-revenue. The FRD requirement needs restating. |
| **Database hosting decision** | See Go-live §3. Trigger is the first real test users. |
| **Langfuse** | Needs a self-hosted instance + `LANGFUSE_*` env. Tracing currently no-ops, so judge behaviour is unobservable — worth doing *before* rubric feedback arrives, since traces are how you answer "why did it say that?". |
| **Rubric feedback** | With Brett and Bryan. When it returns, edits go to `product-docs/features/phase-engine/rubric-v0.md` **and** `src/lib/phase-engine/rubric.ts` — the judge reads the second, not the first. Then ship as v1. |
| **Merge `feat/document-templates` and `feat/agent-delivery-os`** | Both unmerged; the delivery loop itself only exists on the latter. |

---

## Done 2026-07-25, second pass (do not re-dispatch)

Seven PRs, all merged to `main`:

| PR | |
|---|---|
| [#40](https://github.com/SebastianGarces/everyfield_v2/pull/40) | CI hermetic build — first green run since April. Closed [#38](https://github.com/SebastianGarces/everyfield_v2/issues/38) |
| [#41](https://github.com/SebastianGarces/everyfield_v2/pull/41) | People CSV export, browser-validated. Closed [#13](https://github.com/SebastianGarces/everyfield_v2/issues/13); supersedes the mis-based PR #34 |
| [#42](https://github.com/SebastianGarces/everyfield_v2/pull/42) | PR checks run on every PR, not only base `main` |
| [#43](https://github.com/SebastianGarces/everyfield_v2/pull/43) | Preview browser validation: `scripts/preview-url.sh` + `browser-validation` skill |
| [#44](https://github.com/SebastianGarces/everyfield_v2/pull/44) | Dropped unused `hono` / `@hono/zod-openapi` |
| [#45](https://github.com/SebastianGarces/everyfield_v2/pull/45) | Removed husky — its full-project checks duplicated CI |
| [#46](https://github.com/SebastianGarces/everyfield_v2/pull/46) | Formatting automated instead: PostToolUse hook for agent edits, format-on-save for hand edits |

Repo-level, outside any diff:

- **Default branch was `development`, now `main`.** This mattered more than it sounds: the ruleset
  targeted `~DEFAULT_BRANCH`, so it was guarding `development` while `main` had no rules at all.
  The ruleset is now pinned to `refs/heads/main`.
- **Vercel Protection Bypass secret** generated and stored in `.env.local`.
- **Other contributors' work removed** — from the three-day window when this was headed for a
  different scope. PR #12 closed; branches `Wiki-modules`, `development`, `wire-up-sidecar`,
  `sidecar` deleted (SHAs in #12's closing comment). Their *merged* work stays: it is ~835 lines of
  ~60,900 in `src/` and is interleaved through meetings, tasks and communication.
- **Branch cleanup** — remote is now `main` alone. Six merged/superseded branches and twelve local
  leftovers deleted; three stale worktrees removed. `feat/agent-delivery-os` and
  `feat/document-templates` kept, both still unmerged.

## Done in the prior session (do not re-dispatch)

- `CRON_SECRET` set and verified end-to-end: 401 without/with a wrong token, 200 with the correct
  one, 24 of 25 plants assessed, rollover confirmed.
- Oversight `hasSharedContent` fix — ungated insights no longer suppressed.
- Eval corpus sharing postures seeded (4 full / 4 people-only / 4 none).
- `cleanEvalData` FK repair — reseeds would previously fail once assessments existed.
- Rubric rewritten as a standalone review document; sent to Brett and Bryan.
- Dev account switcher on `/login`, verified absent from production builds.
- Oversight empty states already distinguish never-assessed from withheld — `plant-health-card.tsx`
  returns three separate messages ordered so "Not assessed yet" wins. Verified; no work needed.
- **Merged to `main`** via PR #37 (squash, `78f4ef9`). 43 commits, 151 files.
- Design-engineering skills committed (`better-*` + `make-interfaces-feel-better`).
- All three CI build blockers fixed — #38 closed, `pnpm build` now succeeds with an unreachable
  database.
- Neon CLI org-scoping resolved and the branch identifiers recorded above.

## Housekeeping

All previously listed items are cleared: the stale worktrees are gone, the `better-*` skills and
`skills-lock.json` are tracked, and the `health-presentation.ts` reflow is committed. Working tree
clean, no open PRs.

One thing parked outside the repo: `/Users/sebastian/dev/build-until-done-uncommitted-20260725.patch`
— 106 uncommitted lines to `.claude/workflows/build-until-done.js`, rescued from the deleted
`feat-csv` worktree. That file lives only on `feat/agent-delivery-os`, so apply the patch there
before doing further work on the delivery loop, or discard it deliberately.
