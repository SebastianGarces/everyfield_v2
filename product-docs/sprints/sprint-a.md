# Sprint A — Pre-Beta Hardening

**Source:** `product-docs/gap-report-2026-06.md` §6 (Sprint A) — P0 items.
**Goal:** Make the app safe and presentable for Brett's planters. No new product features — close security holes, fix data-corrupting bugs, make the beta runnable.
**Duration target:** ~1 week of agent execution + human review.
**Execution model:** Multi-agent workflow (see §5). Each task below is specced as an independent agent assignment with explicit file ownership, implementation steps, and machine-verifiable acceptance criteria.

**Exit criteria for the sprint:**
1. `pnpm typecheck && pnpm lint && pnpm build` pass.
2. Every acceptance criterion in §3 verified by an adversarial verification agent (Phase V of the workflow).
3. The manual QA checklist (§6) completed by Sebastian.
4. (Human, outside workflow) Draft phase exit criteria emailed to Brett & Bryan — unblocks Sprint B's Phase Engine.

---

## 1. Verified Baseline Facts (grounding for all agents)

These were verified against the repo on 2026-06-10. Agents must re-verify before editing — do not trust blindly if code has moved.

- **`src/api/app.ts`** — Hono `OpenAPIHono` app, basePath `/api/v1`, mounted via `src/app/api/v1/[...route]/`. A generic `crud()` factory registers **unauthenticated, un-scoped** `GET /` (lists ALL rows across ALL tenants), `GET /{id}`, and `POST /` for: `churches`, `people`, `meetings`, `tasks`, `teams`, `communications`. No session check, no `church_id` filter anywhere. `src/proxy.ts` does not protect it (only CSRF logic with webhook exemptions; GETs are unaffected by CSRF anyway).
- **Auth:** custom session auth in `src/lib/auth/` (`session.ts`, `cookies.ts`, `password.ts` — argon2, `actions.ts` — login/register server actions). No rate limiting or attempt tracking anywhere. Registration at `src/app/(auth)/register/{page.tsx,actions.ts}` is fully open.
- **Error tracking:** none. `next.config.ts` is empty. No Sentry/instrumentation files.
- **Feedback:** `feedback` table (migration 0016; columns incl. `category`, `description`, `page_url`, `status` default `'new'`). `src/lib/feedback/service.ts` has **only** `createFeedback`. Submission UI: `src/components/feedback/feedback-button.tsx` (rendered in `src/components/app-sidebar.tsx` ~line 93), action in `src/app/(dashboard)/feedback/actions.ts`. `status` is never read or updated; no list/triage UI exists.
- **Nav placeholders:** `src/lib/navigation.ts` `mainNavItems` has `isDisabled: true` entries for Documents (`/documents`), Financial (`/financial`), Facilities (`/facilities`). (The many `isDisabled` entries under wiki nav are wiki sidebar links — out of scope, do not touch.)
- **Legacy vision-meetings:** complete pre-unification trees still exist and compile: `src/lib/vision-meetings/` (7 files), `src/components/vision-meetings/` (~15 components), `src/app/(dashboard)/vision-meetings/` (full route tree, still served), `src/db/schema/vision-meetings.ts` (NOT exported from the schema index). Verified: nothing under `src/lib/meetings/`, `src/components/meetings/`, or `src/app/(dashboard)/meetings/` imports from the legacy trees. The only outside references are wiki URL strings (`/wiki/.../vision-meetings`) and a commented-out entry in `src/lib/wiki/guide-config.ts` — those are not code dependencies.
- **F8 constraint bug:** `src/db/schema/ministry-teams.ts` ~line 172: `unique("team_memberships_active_unique").on(teamId, personId, roleId)` — a **plain** unique despite the name. `removeMember` in `src/lib/ministry-teams/service.ts` sets `status='inactive'` and keeps the row, so re-assigning the same person to the same role later violates the constraint at the DB level.
- **F3 attendance_type bug (VM-004):** `meeting_attendance.attendanceType` (`first_time` | `returning` | `core_group`) is consumed by `src/lib/meetings/analytics.ts` (new-vs-returning breakdowns) but **never written** by the live capture paths: `toggleAttendanceStatusAction`, `addWalkInAttendeeAction`, `quickAddWalkInAction`, `addToGuestList` set only `status`. All analytics counters read 0.
- **Conventions that bind agents:** migrations via `pnpm db:generate` + `pnpm db:migrate`, NEVER `db:push` (AGENTS.md). NEVER start a dev server. shadcn components via `pnpm dlx shadcn@latest add <name>`. Every clickable element gets `cursor-pointer`. Check `memory/invariants.md` before mutations. Drizzle migration files are auto-numbered — **parallel `db:generate` runs collide; only the Schema agent (Phase S) generates migrations.**

---

## 2. Pre-Flight Decisions (resolved — agents implement as written)

| Decision | Choice | Rationale |
|---|---|---|
| `/api/v1` disposition | **Remove the public mount** (delete `src/app/api/v1/` route dir; keep `src/api/app.ts` compiling but unmounted, or delete both — see A1) | The layer has no consumer yet. Gating it properly (session + per-table church scoping) is real work that belongs to a future API story; until then any mount is attack surface. Fastest safe state: not reachable. |
| Rate limiting mechanism | **Postgres-table-based attempt tracking** (`auth_attempts`), checked in login/register actions | No Redis in stack; in-memory state is unreliable on serverless. The DB is already there, volume is tiny, and it survives instance churn. |
| Admin access for feedback triage | **`ADMIN_EMAILS` env allowlist** (comma-separated), checked server-side | No platform-admin role exists; adding one is a schema/role-model change that shouldn't be rushed in a hardening sprint. Env allowlist is auditable and removable. Upgrade path noted in the task. |
| Invite gating mechanism | **Single shared `BETA_INVITE_CODE` env var**, required at registration when set; absent/empty = open registration (dev-friendly) | One beta cohort, controlled by Sebastian/Brett. Per-invite codes can come with network-sponsored seats (P2/P3). |
| Error tracking | **Sentry** via `@sentry/nextjs` wizard-style manual setup | Default choice, free tier sufficient for beta. |
| attendance_type derivation | **Derive automatically at write time** (no per-row UI this sprint): `core_group` if person's status ∈ {core_group, launch_team, leader}; else `first_time` if person has no prior `attended` record at any earlier meeting; else `returning`. Plus a backfill migration applying the same rule to historical `attended` rows. | Matches FRD semantics, requires zero new UI, fixes the data silently being lost. A manual override selector is a future F3 nicety. |

---

## 3. Task Specifications

Effort: S ≤ half day · M ≤ 2 days. File ownership is exclusive within Phase I — two agents must never edit the same file (shared-file edits are pre-assigned below).

### A0 — Preflight baseline (Phase P; single agent)
Run `pnpm typecheck`, `pnpm lint`, `pnpm build` on the untouched tree; record pass/fail and any pre-existing errors so later failures are attributable. If the baseline is already red, STOP and report — the sprint starts from green.

### A1 — Remove the unauthenticated `/api/v1` surface (S)
**Owns:** `src/app/api/v1/` (delete), `src/api/app.ts` (delete), any references.
**Steps:**
1. `grep -rn "api/v1\|src/api\|from \"@/api" src/` — enumerate every reference (expect: only the route mount and possibly an OpenAPI doc link).
2. Delete `src/app/api/v1/` and `src/api/app.ts`. If anything else imports them, delete/clean those references too.
3. Remove now-unused deps from `package.json` **only if** nothing else uses them: check `@hono/zod-openapi`, `hono`, `drizzle-zod` usage across `src/` first (`drizzle-zod` may be used elsewhere — verify before removing).
**Acceptance criteria:**
- AC1.1: No route handler exists under `src/app/api/v1/`; `grep -rn "basePath(\"/api/v1\")" src/` returns nothing.
- AC1.2: `pnpm build` succeeds with the files removed.
- AC1.3: No orphaned imports of `@/api` remain.
**Note for the PR description:** record that the layer was removed (not lost) — `git log 2e7a4ed` has it if a v1 API is revived later behind auth.

### A2 — Rate limiting on login & register (M)
**Owns:** `src/lib/auth/rate-limit.ts` (new), `src/lib/auth/actions.ts`, `src/app/(auth)/register/actions.ts` (shared with A4 — A2 edits land first; A4 agent rebases on them in Phase I ordering, see §5).
**Schema (created by Phase S agent, not this one):** `auth_attempts` table: `id`, `identifier` (text — lowercased email), `ip` (text, nullable), `kind` (`login` | `register`), `success` (boolean), `created_at`. Index on (`identifier`, `kind`, `created_at`) and (`ip`, `kind`, `created_at`).
**Steps:**
1. `src/lib/auth/rate-limit.ts`: `checkRateLimit(identifier, ip, kind)` — count failures in the window; limits: login ≥5 failed per email per 15 min OR ≥20 per IP per 15 min → reject; register ≥3 per IP per hour → reject. `recordAttempt(...)` to log. Read IP from `x-forwarded-for` (first hop) via `headers()`.
2. Wire into the login action: check before verifying credentials; record success/failure after. On limit, return a generic "Too many attempts — try again later" (no timing/exists leak).
3. Wire into the register action the same way.
4. Cleanup strategy: opportunistic `DELETE WHERE created_at < now() - interval '1 day'` piggybacked on writes (no cron exists yet; fine at beta volume).
**Acceptance criteria:**
- AC2.1: `auth_attempts` table exists in schema + migration (Phase S) and `rate-limit.ts` queries it (no in-memory Maps).
- AC2.2: Login action consults `checkRateLimit` BEFORE password verification and records every attempt.
- AC2.3: Register action consults and records likewise.
- AC2.4: Rate-limit rejection message does not reveal whether the account exists.
- AC2.5: Failed-attempt window resets on success (success rows recorded; counter counts failures only).

### A3 — Sentry error tracking (S)
**Owns:** `next.config.ts`, `sentry.*.config.ts` / `instrumentation.ts` / `instrumentation-client.ts`, `package.json` (sole owner of dependency installs this sprint — see §5 ordering), `.env.example` if present.
**Steps:**
1. `pnpm add @sentry/nextjs`.
2. Manual setup per current Sentry Next.js App Router docs: `instrumentation.ts` (server/edge init via `register()`), `instrumentation-client.ts` (client init), wrap `next.config.ts` with `withSentryConfig`. DSN from `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` env; **init must no-op cleanly when DSN is unset** (local dev).
3. Add a global error boundary if missing (`src/app/global-error.tsx`) reporting to Sentry.
4. Add env names to `.env.example` (if the file exists) and to the PR notes for Vercel env setup.
**Acceptance criteria:**
- AC3.1: `@sentry/nextjs` in dependencies; config present for client + server.
- AC3.2: `pnpm build` succeeds **with no `SENTRY_DSN` set**.
- AC3.3: `global-error.tsx` exists and calls `Sentry.captureException`.
- AC3.4: Source-map upload config does not break builds when `SENTRY_AUTH_TOKEN` is unset (guard or disable).

### A4 — Invite-gated registration + nav cleanup (S)
**Owns:** `src/app/(auth)/register/page.tsx`, register form component(s), `src/lib/navigation.ts`, sidebar rendering of disabled items; **edits `src/app/(auth)/register/actions.ts` after A2** (workflow sequences this — see §5).
**Steps:**
1. Server-side check in the register action: if `process.env.BETA_INVITE_CODE` is non-empty, require a matching `inviteCode` field (case-insensitive trim compare). Reject with "EveryField is in private beta — ask your sending church or network for an invite code."
2. Add the invite-code input to the register form (visible only when gating is on — pass a flag from the server component; do not leak the code).
3. **Important interaction:** the existing org-invitation signup paths (planter invited by sending church/network) must BYPASS the beta code — an invitation token IS the invite. Inspect `src/lib/invitations/` and the register flow for how invitation tokens enter registration; gate only the cold-signup path.
4. Nav cleanup in `src/lib/navigation.ts` + the sidebar component: remove the three `isDisabled: true` feature items (Documents, Financial, Facilities) from `mainNavItems` — comment them out with a `// Sprint A: hidden until built — see gap-report-2026-06.md` note so they're trivially restorable. Do NOT touch wiki-tree `isDisabled` entries.
**Acceptance criteria:**
- AC4.1: With `BETA_INVITE_CODE` set, registration without/with-wrong code is rejected server-side (not just hidden client-side).
- AC4.2: With it unset, registration works exactly as before.
- AC4.3: Invitation-token signup paths succeed without a beta code.
- AC4.4: Documents/Financial/Facilities no longer render in the planter sidebar; wiki nav untouched.
- AC4.5: The actual code value never appears in client-delivered HTML/JS.

### A5 — Delete legacy vision-meetings tree (S)
**Owns:** `src/lib/vision-meetings/`, `src/components/vision-meetings/`, `src/app/(dashboard)/vision-meetings/`, `src/db/schema/vision-meetings.ts`.
**Steps:**
1. Re-verify zero live imports: `grep -rn "vision-meetings\|vision_meetings\|VisionMeeting" src/ --include="*.ts" --include="*.tsx"` excluding the four legacy paths, wiki URL strings, and the commented guide-config line. If a REAL import exists (e.g., the audit noted `/meetings/[id]/analytics` may use legacy analytics components), **move that module into the new tree first** (`src/lib/meetings/` / `src/components/meetings/`), update imports, then delete.
2. Delete all four trees.
3. Add a redirect so old links don't 404: in `next.config.ts` `redirects()`, `/vision-meetings` and `/vision-meetings/:path*` → `/meetings` (permanent: false). (Coordinate: `next.config.ts` is owned by A3 this sprint — the workflow runs A5 after A3, or A5 hands the redirect snippet to the Phase F fix agent. See §5.)
4. Confirm the legacy schema tables: `src/db/schema/vision-meetings.ts` is not exported from the schema index — deleting the file must not generate a drop-table migration (drizzle only sees exported schema). Leave any orphaned DB tables alone this sprint (data safety); note them in the PR for a future cleanup migration.
**Acceptance criteria:**
- AC5.1: All four legacy paths are gone; grep (as above) only matches wiki URL strings.
- AC5.2: `pnpm build` succeeds.
- AC5.3: `/vision-meetings` redirects to `/meetings`.
- AC5.4: No migration was generated by this task.

### A6 — F8 membership re-assignment constraint fix (S)
**Owns:** `src/db/schema/ministry-teams.ts` (schema change executed by Phase S agent per this spec), `src/lib/ministry-teams/service.ts`.
**Schema change (Phase S):** replace the plain `unique("team_memberships_active_unique")` with a **partial unique index**: `uniqueIndex("team_memberships_active_unique").on(teamId, personId, roleId).where(sql`status = 'active'`)`. Migration must drop the old constraint and create the partial index (verify generated SQL does both; hand-edit the migration SQL if drizzle-kit emits an incomplete diff — keep it reviewable).
**Service change (this agent):** in `assignMember` (and any re-activation path), handle the inactive-row case explicitly: if an inactive membership row exists for (team, person, role), UPDATE it back to active (fresh `startDate`, cleared end fields) instead of inserting a duplicate; keep the existing event emissions intact.
**Acceptance criteria:**
- AC6.1: Schema uses a partial unique index with `WHERE status = 'active'`; migration SQL contains `DROP CONSTRAINT`/`DROP INDEX` for the old unique and `CREATE UNIQUE INDEX ... WHERE`.
- AC6.2: `assignMember` re-assignment path (assign → remove → assign again, same person+role) cannot violate the constraint: re-activation logic is present and emits `team.member.assigned` as before.
- AC6.3: Two ACTIVE rows for the same (team, person, role) remain impossible.

### A7 — Fix attendance_type capture + backfill (M)
**Owns:** `src/lib/meetings/service.ts` (attendance write paths), `src/lib/meetings/attendance-type.ts` (new helper), the meeting attendance server actions file(s) under `src/app/(dashboard)/meetings/`.
**Steps:**
1. New helper `deriveAttendanceType(personId, meetingId, meetingStartsAt, db)`: person status ∈ {`core_group`, `launch_team`, `leader`} → `core_group`; else any prior `meeting_attendance` row for this person with `status='attended'` at a meeting earlier than this one → `returning`; else `first_time`.
2. Call it wherever a row transitions to `attended` (toggle action, walk-in adds, finalize path if it marks attendance) and persist `attendanceType`. Only set when marking attended; clear or leave null when un-marking.
3. **Backfill (Phase S custom migration `pnpm db:generate --custom`):** SQL applying the same derivation to existing `attended` rows with `attendance_type IS NULL` — core-group rule from current person status (best available approximation; note the approximation in a SQL comment), first-time/returning via a window function over each person's attended rows ordered by meeting date (earliest attended → `first_time`, later → `returning`, unless core_group rule applies).
4. Confirm `src/lib/meetings/analytics.ts` consumes the values correctly (it already does — read-only check).
**Acceptance criteria:**
- AC7.1: Every code path that sets `status='attended'` also sets a non-null `attendanceType` via the shared helper (grep-verifiable: no `.attended` write without it).
- AC7.2: Helper logic matches the derivation rules above (correct precedence: core_group first).
- AC7.3: Backfill migration exists, is idempotent (`WHERE attendance_type IS NULL`), and never overwrites existing non-null values.
- AC7.4: New-vs-returning analytics return non-zero for a church with backfilled attended rows (verification agent may reason over the SQL + seed data rather than a live DB).

### A8 — Feedback admin triage view (M)
**Owns:** `src/lib/feedback/service.ts`, `src/lib/auth/admin.ts` (new), `src/app/(dashboard)/admin/feedback/` (new route tree), feedback components (new), nav entry for admins.
**Steps:**
1. `src/lib/auth/admin.ts`: `isPlatformAdmin(user)` — checks the session user's email against `ADMIN_EMAILS` (comma-separated, case-insensitive). `requirePlatformAdmin()` guard that redirects/404s otherwise. Comment the upgrade path (future `platform_admin` role).
2. Extend `src/lib/feedback/service.ts`: `listFeedback({status?, category?, page})` (newest first, include submitting user email + church via joins) and `updateFeedbackStatus(id, status)`. Status enum: reuse what migration 0016 defined (verify actual values; expected `new` / `reviewed` / `resolved`-style — match schema, don't invent).
3. Route `src/app/(dashboard)/admin/feedback/page.tsx`: table (date, user, church, category badge, page URL, description, status select), status filter tabs, server actions for status updates. Guard with `requirePlatformAdmin()` — also guard the actions, not just the page.
4. Nav: show an "Admin" item only when `isPlatformAdmin` (server-side decision passed to the sidebar — `navigation.ts` is owned by A4; this agent adds the conditional render in the sidebar/server component side only, or lands after A4 per §5 ordering).
5. UI bits: use existing shadcn components already in the repo (table, badge, select, tabs); add missing ones via `pnpm dlx shadcn@latest add <name>`; every interactive element `cursor-pointer`.
**Acceptance criteria:**
- AC8.1: Non-admin (email not in `ADMIN_EMAILS`) hitting `/admin/feedback` gets 404/redirect — verified at page AND server-action level.
- AC8.2: `listFeedback` returns submissions with user/church context; pagination or sane LIMIT present.
- AC8.3: Status can be updated and persists; values match the schema enum exactly.
- AC8.4: Feedback `description` renders as text (no rich-text/HTML injection path).
- AC8.5: Admin nav item invisible to non-admins.

---

## 4. Dependency & Parallelization Map

```
Phase P  A0 preflight (baseline green check)
Phase S  Schema agent: ALL schema edits + ONE `pnpm db:generate` run
         ├─ auth_attempts table (for A2)
         ├─ F8 partial unique index (A6 schema half)
         └─ attendance_type backfill custom migration (A7 backfill half)
         then `pnpm db:migrate` against dev DB
Phase I  Implementation (parallel, exclusive file ownership):
         Wave 1 (fully parallel): A1, A2, A3, A5*, A6-service, A7-code
         Wave 2 (after Wave 1):  A4 (touches register actions after A2;
                                  navigation.ts), A8 (sidebar after A4)
         *A5's next.config.ts redirect lands via Wave 2/Phase F because A3
          owns next.config.ts in Wave 1.
Phase V  Verification (parallel, read-only adversarial agents per task)
         + one integration gate: typecheck, lint, build
Phase F  Fix loop: failed criteria → fix agents → re-verify (max 2 rounds)
Phase R  Final: build gate, diff-level code review, summary report
```

Shared-file conflicts resolved by ordering: `register/actions.ts` (A2 → A4), `navigation.ts`/sidebar (A4 → A8), `next.config.ts` (A3 → A5-redirect), `package.json` (A3 only). The Schema agent is the **only** agent that runs `pnpm db:generate`.

---

## 5. Workflow Design (for the `Workflow` tool)

Single workflow, six phases, ~18–22 agent invocations. Run on a dedicated branch (`git checkout -b sprint-a` before invoking). All agents work in the shared tree (no worktree isolation — migrations and file-ownership ordering make worktrees counterproductive here); ownership boundaries enforced via prompts + ordering above.

**Meta/phases:** `Preflight` → `Schema` → `Implement` → `Verify` → `Fix` → `Report`.

**Agent assignments:**

| Phase | Agents | Type | Output schema |
|---|---|---|---|
| Preflight | 1 | general | `{green: bool, errors: []}` — abort workflow if red |
| Schema | 1 | backend | `{migrationFiles: [], applied: bool, notes}` |
| Implement W1 | 6 (A1, A2, A3, A5, A6, A7) | backend/frontend per task | `{task, filesChanged: [], completed: [], blocked: [], notes}` |
| Implement W2 | 2 (A4, A8) | frontend | same |
| Verify | 8 (one per task) + 1 integration gate | code-reviewer / general | `{task, criteria: [{id, pass, evidence, failureDetail}]}` |
| Fix | 0–N (one per failed task) | matching impl type | same as impl |
| Report | inline (main loop synthesizes) | — | — |

**Prompt construction rules:**
- Each implementation agent receives: its full task spec from §3 verbatim, the §1 baseline facts, the binding conventions (no dev server, no db:push, no db:generate except Schema agent, cursor-pointer, shadcn CLI), its exclusive file list, and the instruction to read `memory/invariants.md` first.
- Each **verification agent is adversarial and read-only**: it receives the task's acceptance criteria and the implementer's `filesChanged` claim, and is instructed to try to FAIL each criterion — read the code, trace the logic, check edge cases (e.g., AC4.5: actually search the built client bundle/page payload reasoning for the invite code; AC2.4: compare error messages between unknown-email and rate-limited paths). It must cite file:line evidence for every pass/fail. Default to fail when uncertain.
- The **integration gate agent** runs `pnpm typecheck && pnpm lint && pnpm build` and reports raw output. It runs once after each Implement/Fix round, not per task.
- **Fix loop:** for each task with any failed criterion, spawn one fix agent with the failure evidence; then re-run only that task's verification agent + the integration gate. Maximum 2 fix rounds; anything still failing is reported, not force-fixed.
- The workflow returns a structured summary: per-task criteria status, files changed, migrations created, and unresolved items. The main loop writes `product-docs/sprints/sprint-a-results.md` and stops — **commit/PR is a human decision.**

**Skeleton (condensed; flesh out prompts from §3 at invocation time):**

```js
export const meta = { name: 'sprint-a', description: 'Pre-beta hardening sprint', phases: [
  { title: 'Preflight' }, { title: 'Schema' }, { title: 'Implement' },
  { title: 'Verify' }, { title: 'Fix' }, { title: 'Report' } ] }

phase('Preflight')
const base = await agent(PREFLIGHT_PROMPT, { schema: GREEN_SCHEMA })
if (!base.green) return { aborted: 'baseline red', errors: base.errors }

phase('Schema')
const schema = await agent(SCHEMA_AGENT_PROMPT, { agentType: 'backend', schema: SCHEMA_RESULT })

phase('Implement')
const wave1 = await parallel([A1, A2, A3, A5, A6, A7].map(t => () =>
  agent(implPrompt(t, schema), { label: `impl:${t.id}`, agentType: t.agentType, schema: IMPL_SCHEMA })))
const wave2 = await parallel([A4, A8].map(t => () =>
  agent(implPrompt(t, schema), { label: `impl:${t.id}`, agentType: 'frontend', schema: IMPL_SCHEMA })))

phase('Verify')
let results = await runVerification(allTasks, [...wave1, ...wave2])  // parallel verify agents + gate

phase('Fix')
for (let round = 0; round < 2; round++) {
  const failed = results.filter(r => r.criteria.some(c => !c.pass))
  if (!failed.length) break
  await parallel(failed.map(f => () => agent(fixPrompt(f), { label: `fix:${f.task}`, schema: IMPL_SCHEMA })))
  results = await runVerification(failed.map(f => taskById(f.task)), ...)   // re-verify failed only + gate
}

return { results, gate: lastGateOutput, migrations: schema.migrationFiles }
```

---

## 6. Manual QA Checklist (human, after workflow + before merge)

With your already-running dev server on localhost:3000 (per AGENTS.md, the workflow never starts one):

- [ ] `curl localhost:3000/api/v1/people` → 404.
- [ ] 6 wrong-password logins → 6th returns the rate-limit message; correct password after window works.
- [ ] Register without invite code (with `BETA_INVITE_CODE` set locally) → rejected; with code → succeeds.
- [ ] Sidebar: no Documents/Financial/Facilities; feedback button still present.
- [ ] `/vision-meetings` → redirected to `/meetings`.
- [ ] Teams: assign → remove → re-assign same person to same role → no error.
- [ ] Mark attendance on a meeting → check `meeting_attendance.attendance_type` populated; analytics page shows non-zero new/returning.
- [ ] `/admin/feedback` as allowlisted email → triage table works; as another user → 404.
- [ ] Submit feedback → appears in admin view; status change persists.
- [ ] Vercel env vars set before deploy: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `BETA_INVITE_CODE`, `ADMIN_EMAILS`.
- [ ] Send draft phase exit criteria to Brett & Bryan (Sprint B unblock).
