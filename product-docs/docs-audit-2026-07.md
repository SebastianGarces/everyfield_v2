# Docs-vs-Code Audit — 2026-07-25

Method: every repo-specific `.md`/`.mmd` file (89 files; vendored reference skills swept per-directory) was read in full by an audit agent and checked claim-by-claim against the code on `main`. Every stale claim cited below was verified against a concrete `file:line`. Delete/merge recommendations were adversarially re-verified (repo-wide reference grep, git history, unique-content check). Code is treated as ground truth; FRD requirement gaps are reported, not resolved — open decisions are in §4.

## 1. Actions taken in this branch

### Deleted (verified safe — no live references, superseded)

| File | Why |
|------|-----|
| `product-docs/features/vision-meeting-management/` (frd, checklist, implementation-plan) | Byte-near-identical duplicate of `features/meetings/` — commit `1ac8eb1` ("unified meetings") created the successor; code has only `src/app/(dashboard)/meetings` + `src/db/schema/meetings.ts`, no `vision-meetings` module |
| `product-docs/features/meetings/implementation-plan.md` | Point-in-time build plan; the work landed, plan has no residual reference value |
| `product-docs/features/people-crm/implementation.md` | Described a pre-refactor implementation; contradicted current code in 9 places; content superseded by frd + checklist + memory |
| `.agents/skills/make-interfaces-feel-better/` | Near-verbatim duplicate of `.agents/skills/better-ui/` (same author's expanded successor); also removed from `skills-lock.json` |

### Updated (factual drift fixed against code)

- **memory contracts** (highest severity found): `memory/contracts/api.md` documented 3 of 6 route handlers and ~2 of 14 server-action files; `memory/contracts/db.md` documented 20 of 34 tables and still had a "Vision Meeting Tables" section sourced to a schema file that no longer exists; `memory/contracts/config.md` listed 4 of ~20 env vars. `memory/entrypoints.md` pointed the entire meetings section at nonexistent `vision-meetings/` paths. All rebuilt from source (≤50 KB budget kept).
- **Root docs**: `AGENTS.md` (skills index vs disk), `README.md`, `memory/index.md`, `memory/README.md`, `memory/invariants.md`, `.agents/memory-first.md`, 3 memory flow diagrams.
- **Product core**: `system-architecture.md`, `core-data-contracts.md`, `dependency-graph.md/.mmd`, `app-summary.md`, `prd.md`.
- **Status docs**: `work-queue.md`, `wiki/article-checklist.md` fixed in place; `gap.md`, `gap-report-2026-06.md`, `sprints/sprint-a-results.md` kept as historical records with a dated correction banner.
- **Skills/ops**: `definition-of-done`, `resolving-merge-conflicts`, `ops/agent-os/labels.md` (one stale claim each).
- **FRD checklists** for wiki, people-crm, meetings, communication-hub, tasks, progress-dashboard, ministry-teams, phase-engine re-trued against code (both directions — items checked that weren't built, and items built that weren't checked).

### Kept as-is (verified accurate)

All four `.claude/agents/*.md`, both `.claude/commands`, `ops/agent-os/{README,dod,invocation}.md`, 11 of 16 `.claude/skills`, `product-brief.md`, `launch-playbook.md`, `sprint-a.md`, `phase-engine/{data-posture,rubric-v0}.md`, `church-plant-agent/vision.md`, all research docs (brainlift ×2, landscape research, adjacent-domain — no duplication between the two brainlifts; both still referenced), financial-tracking and facility-management FRDs + checklists (accurate: they truthfully claim nothing is built), and the vendored skill directories.

## 2. FRD gap report (requirement vs implementation)

Status counts per feature, from per-requirement inspection of `src/`:

| Feature | Implemented core | Partial | Missing | Diverged | Notes |
|---------|-----------------|---------|---------|----------|-------|
| Wiki (F1) | W-001..008, 011..013, 015 verified | 1 | 14 | 4 | Search shipped as Cmd+K palette, not results page; no TOC, feedback, PDF, templates/videos |
| People CRM (F2) | Core pipeline solid | 3 | 9 | 0 | Teams tab still a placeholder though F8 now exists; detection-without-merge for duplicates; no photo upload UI |
| Meetings (F3) | Core meetings + RSVP-via-token | 2 | 6 | 4 | attendance_type is derived not user-set; follow-up tasks for ALL attendees (intentional per code comment); orphaned invitations table/components |
| Communication Hub (F9) | Send + templates + merge + Resend webhooks | 3 | 9 | 0 | No SMS, no scheduled send, no rich text, no resend-to-non-openers; `communication.sent` event never emitted |
| Tasks (F5) | T-001..010 all verified | 4 | 8 | 0 | Schema supports subtasks/recurrence but no UI/engine; no notifications, bulk ops, templates |
| Progress Dashboard (F4) | D-006/007/009 | 7 | 5 | 4 | Much of the FRD's intent migrated to the `/phase` Plant Intelligence surface — see decisions |
| Ministry Teams (F8) | Teams, roster, training, health | 5 | 4 | 1 | **Authorization gap**: actions check only session+churchId, no team-leader/member scoping (FRD §Authorization) |
| Financial (F7) | — | 0 | 19 | 0 | Zero code; nav commented out (`src/lib/navigation.ts:75-76`); readiness is attestation-only in phase engine |
| Facility (F10) | — | 0 | 26 | 0 | Zero code; nav commented out (`src/lib/navigation.ts:92-98`, "Sprint A: hidden until built") |
| Document Templates (F6) | — on `main` | 0 | 25 | 1 | Phase-1 (16/25) exists only on unmerged local branch `feat/document-templates` (last commit 2026-06-22) |
| Phase Engine (PE) | Judge, signals, insights, cron, oversight | 2 | 4 | 0 | Gaps are the three Nice-to-Haves + the NFR-PE-4 plain-language disclosure |

Full per-requirement evidence (419 lines, every gap with `file:line`): kept out of this doc for size; see the audit run artifacts or ask for the full table for any feature.

Cross-cutting findings worth naming:

- **Dead code flagged by doc drift**: meetings `invitations` table + `createInvitationAction`/`updateInvitationStatusAction` + `invitation-tracker/leaderboard` components have zero importers (FRD dropped VM-017 but code kept it). `pipeline-metrics.tsx` (P-020) is defined but imported nowhere. `meeting-reminder.tsx` email template is imported nowhere.
- **Stale deferral rationale**: people-crm P-021/P-022 ("blocked by F8") — F8 shipped; the placeholder page and the deferral reason are both outdated.
- **Contract without consumer**: `getPersonTeams` backend exists for the person-profile Teams tab that still renders a hardcoded placeholder.

## 3. Docs held pending decision — now resolved

- `.claude/skills/wiki-articles/SKILL.md` — workflow writes MDX to a repo-root `wiki/` dir deleted when articles migrated to the DB (`scripts/migrate-wiki-to-db.ts`, commit `6f9445a`). **Resolved (#18): archive it.** There is no DB-era authoring path at all — only the one-time migration script — so the skill cannot be reworked until authoring is designed.
- `.claude/skills/work-in-progress/SKILL.md` — pre-factory interactive flow; its Risk Gate halts high-risk work while the delivery OS ships high-risk to PR. **Resolved (#19): extract the memory-maintenance section, retire the rest**, and re-point `.agents/memory-first.md`.
- `product-docs/features/document-templates/checklist.md` — blind to the 16/25 items done on `feat/document-templates`. **Resolved (#1): PR the branch through CI + the DoD**, after which the checklist is re-trued against merged code.

## 4. Decision ledger — MOVED

The ledger this section held (the 2026-07-26 audit decisions plus every ruling appended
through 2026-08-09) moved to **[`product-docs/decisions.md`](decisions.md)** on 2026-08-10
and continues there. New rulings land there, not here. The §5 evidence below supports rows
now in that file.

## 5. Pending — evidence gathered, decision outstanding

**All three items below were ruled on 2026-07-27** — rulings in §4 above. Evidence kept for the record.

### #10 Meetings — five divergences

| # | FRD says | Code does | Evidence |
|---|----------|-----------|----------|
| 1 | `attendance_type` user-marked (AC 3) | **Derived**, with documented precedence: `core_group`/`launch_team`/`leader` status → `core_group`; else any *prior* attended meeting → `returning`; else `first_time`. Must be called by every path transitioning to `status='attended'`. | `src/lib/meetings/attendance-type.ts:1-45` |
| 2 | Follow-up tasks for **new** attendees, due **meeting date + 48h** | Follow-up for **every** attendee, due **finalization + 2 days**, priority high, assigned to the planter; `vision_meeting` type only; plus a separate evaluation task due +1 day. Code comment justifies it: *"the planter can dismiss duplicates if a person has an existing follow-up from a prior meeting."* | `src/lib/tasks/events.ts:115-200` |
| 3 | RSVP via a dedicated invitee table (VM-028) | `meeting_confirmation_tokens` (in the **communication** schema) + public `/rsvp/[token]` route + `/api/rsvp/[token]`. No invitee table. | `src/db/schema/communication.ts:196-220`, `src/app/rsvp/[token]/` |
| 4 | Roster auto-population for team meetings (VM-006) | `church_meetings.team_id` exists and is joined/filtered on, but no auto-population of attendance from the team roster. | `src/lib/meetings/service.ts:127,186,220` |
| 5 | Automated reminders (VM-018) | **No reminder automation at all** — no cron, no scheduler. `meeting-reminder.tsx` exists but is imported nowhere. Manual template sends are the shipped path. | no `src/app/api/**/cron`; zero importers of `meeting-reminder.tsx` |

**The one to actually think about is #2** — it changes how much task noise a planter gets after every
vision meeting. The other four are doc-fixes.

### #12b MT-011 — training model

- **FRD:** "Track required training completion **per role**" (`ministry-team-management/frd.md:67`)
- **Shipped:** training is **team-level** — `training_programs.team_id` + `is_required`; completion
  tracked per person via `training_completions.person_id`. `team_roles` has no `required_training_ids`
  column. (`src/db/schema/ministry-teams.ts:188-243`)

Role-level would need a new column or join table → migration → `risk:high`.

### #14 Wiki data model — four divergences

FRD `WikiArticle` (`wiki/frd.md:902+`) vs shipped `wiki_articles` (`src/db/schema/wiki.ts:68-92`):

| FRD | Shipped |
|-----|---------|
| `section` (String) | `section_id` (uuid FK → `wiki_sections`) |
| `related_article_ids` (UUID[]) | `related_article_slugs` (text[]) |
| `parent_article_id`, `related_template_ids` | **absent** |
| content_type: `tutorial`/`how_to`/`explanation`/`reference` | same **plus `overview`, `guide`** |

Shipped is arguably better on three of four (an FK beats a string; slugs match how `wiki_progress` and
`wiki_bookmarks` already key). `related_template_ids` is the one worth keeping as a target, since #6
kept templates/downloads.
