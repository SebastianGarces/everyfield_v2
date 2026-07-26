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

## 3. Docs held pending your decision (not touched)

- `.claude/skills/wiki-articles/SKILL.md` — its whole workflow writes MDX to a repo-root `wiki/` dir that was deleted when articles migrated to the DB (`scripts/migrate-wiki-to-db.ts`, commit `6f9445a`). Style guidance is still good; the mechanics are dead.
- `.claude/skills/work-in-progress/SKILL.md` — describes the pre-Agent-Delivery-OS interactive flow; conflicts with the factory pipeline (its Risk Gate halts high-risk work; the delivery OS ships high-risk autonomously). Still referenced by `.agents/memory-first.md` for memory maintenance.
- `product-docs/features/document-templates/checklist.md` — truthful for `main` (all unchecked) but blind to the 16/25 items done on unmerged `feat/document-templates`.

## 4. Decision queue

See the summary presented with this audit (also reproduced here for the record):

**Direction / roadmap**
1. F6 document-templates: merge the stale local branch `feat/document-templates`, rebuild, or abandon (main has moved 17 PRs since).
2. F7 financial: still on roadmap, or formally "attestation-only via phase engine"?
3. F10 facility: confirm deferred; annotate FRD as deferred so audits stop re-litigating.
4. Progress Dashboard FRD vs Plant Intelligence: is `/phase` the canonical successor to D-002 (exit criteria), D-005 (CSF scorecard), D-016 (wiki links), D-017 (drill-down)? Rewrite FRD or keep deterministic dashboard as future complement?
5. Coach surfaces: D-018 coach dashboard, wiki-progress oversight visibility (W integration contracts), people oversight views, communication-log coach access — in or out (per feature)?
6. Wiki roadmap trims: video library (W-019), templates/downloads + WikiTemplate/WikiVideo/WikiSearch tables, search-results page vs Cmd+K palette as canon.
7. SMS (COM-011) and scheduled sending (COM-014): keep or cut from FRD.
8. Polymorphic Note entity (communication-hub FRD): still planned, or per-entity notes columns are canon?
9. T-020 phase-triggered task templates: superseded by Plant Intelligence insights?

**Code-vs-FRD canon (code did something different on purpose)**
10. Meetings: derived attendance_type vs user-marked (AC 3); follow-up tasks for all attendees at finalize+48h vs new-only at meeting-date+48h (VM-007); RSVP via meeting_attendance+tokens vs dedicated invitee table (VM-028); roster auto-population for team meetings (VM-006); automated reminders vs manual template sends (VM-018).
11. Meetings invited-by tracking: VM-017 was dropped from the FRD but table/actions/components remain — dead code to remove, or requirement to re-add?
12. Ministry teams: team-level vs role-level training model (MT-011); planter-only auth vs team-leader/member scoping server-side (security-relevant); weekly automated health check vs on-demand dashboard.
13. People CRM: un-defer P-021/P-022 (Teams tab) now that F8 exists?
14. Wiki data model: rewrite FRD to shipped schema or treat schema as converging?
15. Document templates data model (if F6 proceeds): DB-backed tables + API vs code-defined generate-on-demand catalog.
16. Phase engine: where does the NFR-PE-4 plain-language data-processing disclosure ship (must describe current posture incl. sharing-until-beta); is `/phase` the permanent Focus-panel home or does it also surface on the dashboard when F4 lands?
17. COM-009: add ministry-team rosters to recipient quick-select, or status-groups are canon scope?

**Doc-mechanics**
18. `wiki-articles` skill: rework for DB-era authoring (how are articles authored now?), or archive.
19. `work-in-progress` skill: retire/absorb into the delivery OS, or keep for interactive (non-factory) work with its memory-maintenance section extracted?
