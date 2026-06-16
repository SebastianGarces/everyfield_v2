# EveryField — Comprehensive Gap & Roadmap Report (June 2026)

**Date:** June 10, 2026
**Method:** Multi-agent audit — 10 per-feature audits (FRD + checklist vs. actual code), cross-cutting infrastructure audit, strategic-docs analysis, and 3 blind-spot analyses (domain expert, market/competitive, product-ops lenses). All claims verified against source code on branch `chore/claude-agents-skills` (migrations through 0017).
**Supersedes:** `gap.md` (Feb 2026 baseline) for implementation-status claims. `gap.md` remains the record of the pastor-meeting discussion.

**How to use this document (for an LLM planning next deliverables):** Section 1 is the verified current baseline. Section 2 lists what shipped since gap.md. Section 3 is the prioritized gap backlog (P0–P3) with reasoning. Section 4 is net-new feature opportunities not in any FRD. Section 5 explains the prioritization framework. Section 6 is a suggested delivery sequence. Effort estimates: small (≤2 days), medium (3–7 days), large (1–3 weeks). All file references are real paths in the repo.

---

## 1. Verified Implementation Baseline (June 2026)

| Feature | Status | Notes |
|---|---|---|
| F1 Wiki | **Substantial** | 8/10 Must Haves. Missing: related articles (W-009), template linking (W-010, blocked on F6). Church-scoped articles unreachable (query bug). |
| F2 People/CRM | **Substantial** (most mature) | All 12 Must Haves done. Event-driven status progression LIVE (checklist stale). Missing: photo upload, duplicate merge, CSV export, oversight access. |
| F3 Meetings | **Substantial** | Unified meeting model, RSVP, evaluations, 48h follow-up task automation LIVE. **Bug: attendance_type never set → new-vs-returning analytics read 0.** Legacy `/vision-meetings` dead code tree still shipped. |
| F4 Progress Dashboard | **Partial** | Real dashboard now exists (4 metric cards, activity feed, quick actions). Everything phase-related, CSF scorecard, launch countdown, coach dashboard: missing. |
| F5 Tasks | **Substantial** | All 10 Must Haves done incl. auto follow-up/evaluation tasks + auto-completion engine. Zero Should Haves (templates, milestones, dependencies, GANTT, notifications). |
| F6 Document Templates | **None** | Zero code. Disabled nav placeholder only. |
| F7 Financial Tracking | **None** | Zero code. Disabled nav placeholder only. |
| F8 Ministry Teams | **Substantial** | All 11 Must Haves done. Frozen since Feb. **Authorization not enforced** (any church user has full write). Re-assignment unique-constraint bug. |
| F9 Communication Hub | **Substantial** | Full email pipeline + tracking. Missing: SMS, scheduled send, history filters, `communication.sent` event, team quick-select. |
| F10 Facility Management | **None** | Zero code. Disabled nav placeholder only. |

**Cross-cutting:**

| Area | Status |
|---|---|
| Phase Engine | **Missing.** Still constants-only. NO code anywhere writes `churches.current_phase` — it is a static label that can never change. No `phase.changed` event. |
| Event system | **Partial.** 5 active subscriptions (meeting→status, team→status, attendance→tasks, evaluation→auto-complete). `task.completed`, `team.staffing.changed`, `training.scheduled` emitted but no subscribers. |
| In-app feedback | **Half done.** Collection works (button, table, categories). **No admin/triage view — submissions are write-only.** |
| Pipeline inactivity + status reasons | **Done.** (Brian's Tier-1 ask, fully shipped — see §2.) |
| Data export (CSV) | **Missing.** Zero export anywhere. |
| AI / RAG / automation | **Missing.** Zero AI code on this branch. No AI SDK deps, no embeddings, no LLM calls. April sprint goals have no trace in the repo. |
| SMS / Planning Center | **Missing.** Schema placeholders only. |
| Production readiness | **Missing.** No error tracking, no rate limiting (incl. login/register), no monitoring/analytics, no cron/scheduler infra. ⚠️ See P0-1. |

---

## 2. What Shipped Since gap.md (Feb 2026) — Re-baseline

gap.md's Tier-1 "Near-Term" list is now **~60% complete**. Done since February:

1. **Task Management (F5) Phase 1+** — full schema/service/routes, "My Tasks", grouped list, AND the deferred `meeting.attendance.finalized → follow-up tasks` subscription is live, plus an auto-completion engine not even in the FRD.
2. **Pipeline visual indicators + manual status reasons** (gap.md Gap #1) — fully shipped, slightly beyond spec (reason required for ALL manual changes; configurable warning/alert thresholds via migration 0017).
3. **Per-attendee meeting notes** (gap.md Gap #1, item 3) — shipped (`addAttendeeNoteAction`, attendee-notes component).
4. **In-app feedback** (gap.md Gap #5) — collection half shipped (no admin view).
5. **Dashboard step 1** (gap.md Gap #6 "Now" items) — metric cards, activity feed, quick actions shipped.
6. Resend integration deepened (React Email, RSVP buttons, signed webhooks); Hono `/api/v1` OpenAPI layer added; health endpoint; pre-commit hooks.

**Still open from gap.md Tier 1:** Phase Engine (zero progress), Document Templates F6 (zero progress), feedback admin view.
**Stale docs:** Feature checklists (esp. F2, F3, F5, F8) significantly understate what's built — trust code, not checklists. gap.md's "Fully Implemented" labels for F8/F9 overstate FRD completeness (Must Haves yes, Should Haves no).

---

## 3. Prioritized Gap Backlog

### P0 — Fix before exposing the app to real users (trust/safety; days, not weeks)

| # | Item | Why P0 | Effort |
|---|---|---|---|
| P0-1 | **Audit/lock down the Hono `/api/v1` layer** (`src/api/app.ts`). The audit flagged it as exposing generic Drizzle-derived CRUD, possibly without auth/tenancy checks. Verify; if confirmed, gate behind auth + church scoping or remove until needed. | A cross-tenant unauthenticated CRUD surface negates every privacy toggle and invariant in `memory/invariants.md`. Must be resolved before Brett's planters touch the app. | small |
| P0-2 | **Rate limiting on login/register + error tracking (Sentry or similar)** | Open registration with no throttling and no error visibility = blind beta. Cheapest possible insurance. | small |
| P0-3 | **Feedback admin view** — list/status-update UI for the existing `feedback` table | Collection without triage is theater; this was an explicit meeting action item and the beta's feedback loop depends on it. | small |
| P0-4 | **Beta mechanics:** invite-gated registration; hide or "coming soon"-label the 3 disabled nav items (Documents/Financial/Facilities) | Controls cohort, prevents "unfinished product" signal, makes churn interviewable. | small |
| P0-5 | **Delete legacy `/vision-meetings` code tree** (lib, components, routes, schema file) — still reachable, queries old paths, will diverge | Data-corruption risk if a beta user lands on the old route. Pure deletion. | small |
| P0-6 | **F8 membership re-assignment unique-constraint bug** (plain unique on team/person/role, but removeMember keeps inactive rows → DB error on re-assign) | A guaranteed-to-happen crash in a core flow. | small |
| P0-7 | **F3 attendance_type bug (VM-004)** — live attendance UI never sets it, so new-vs-returning counters read 0 | Silently corrupts the meeting analytics the pastors care about; data lost now is unrecoverable later. | medium |

### P1 — Highest-value product work (the next 4–8 weeks)

**P1-1. Phase Engine** (large) — *The single most load-bearing gap in the platform.*
Reasoning: nothing in the codebase can even change `current_phase` today. It blocks: dashboard exit-criteria display (D-002/D-017), phase-triggered task templates (T-020), wiki phase-change content discovery, F8 phase awareness (AC-007), sending-church readiness assessment — i.e., the core promise discussed with Brett and Bryan, who are *waiting* to validate exit criteria. It was also the April sprint's headline goal and produced nothing. Build per gap.md's still-valid spec: soft gating, planter-initiated transitions, criteria-as-queries + manual toggles, audit trail, `phase.changed` event. **Prerequisite action: send Brett/Bryan the draft exit criteria for validation now — it's the only external dependency.**

**P1-2. Onboarding wizard + phase self-assessment** (medium) — *Activation; pairs with P1-1.*
Reasoning: currently the only way `current_phase` gets set is the default 0, and a mid-journey planter (the realistic beta user) lands on an empty dashboard with a wrong phase label. Steps: church profile + target launch date, "where are you in the journey?" self-assessment, first contacts import, seeded phase task list. Add a `launch_date` column to churches (also unblocks D-004 countdown and merge fields). This is the difference between beta users returning for session two or not.

**P1-3. Dashboard F4 expansion wave 2** (medium) — phase stepper (D-001), exit-criteria progress (needs P1-1), launch countdown (needs P1-2's column), core-group target bar + growth delta, partial CSF scorecard with available factors (Unity/Critical Mass/Leadership have data today; Giving = manual toggle until F7).
Reasoning: this is what planters see daily and what reduces "chasing planter updates" — the sending churches' #1 stated value.

**P1-4. Oversight portfolio metrics with privacy gating** (medium) — per-plant summary cards (core group, last activity, phase, health), aggregate portfolio stats, per-metric `share_*` gating with "Not shared" states. Also: **the org-invitations service is dead code with no UI — oversight admins literally cannot invite planters today.** Wire that UI first.
Reasoning: sending churches are the GTM channel and currently get phase counts only; the invitation hole blocks the beta's own distribution mechanism.

**P1-5. Notification/scheduler infrastructure + weekly digest** (medium) — Vercel cron (or similar) + `notification_preferences` table + first consumer: Monday-morning planter digest (stale follow-ups, this week's meetings, overdue tasks).
Reasoning: one shared layer unblocks four separately-listed FRD gaps (T-018 task notifications, VM-018 meeting reminders, COM-014 scheduled sending, F8 weekly health check). Bivocational planters (69%) aren't in the app daily; retention requires outbound.

**P1-6. Quick-wins batch** (each small; bundle into one sprint):
- People CSV export (P-027; elevated in gap.md, explicit action item, still missing)
- Wire person "Teams & Training" tab to live F8 data (placeholder; now unblocked)
- W-009 related articles render + prev/next nav (Must Have; schema exists)
- Fix church-scoped wiki article queries (Must Have data-model spec; query hardcodes null)
- F9 message history filters/search (Must Have sub-scope; validation schema already exists)
- F9 team-roster quick-select (Must Have; F8 data exists)
- Team-meeting guest list auto-population from roster (VM-006 Must Have)
- Wrap `finalizeAttendance` in a transaction (NFR)
- Extend wiki contextual guide config to meetings/teams routes (config-only)

**P1-7. F8 authorization enforcement** (medium) — FRD tiers (planter CRUD / leader scoped write / member read / coach read) vs. today's any-church-user-full-write.
Reasoning: becomes a real problem the moment multi-user accounts (P2-6) or coaches arrive; cheaper to do before those.

### P2 — Medium-term (beta period; build as P1 lands)

| # | Item | Reasoning | Effort |
|---|---|---|---|
| P2-1 | **F6 Document Templates, Phase 1** — code-defined read-only catalog at `/documents` (role-templates pattern), then PDF generation for top 3 templates (commitment card, sign-in sheet, VM agenda) with merge fields | Last untouched Tier-1 meeting commitment. Adjacent infra (S3 storage, merge-field engine in F9) now exists, cutting cost vs. Feb estimate. | medium |
| P2-2 | **F5 Phase 2: checklist templates by phase + milestones** | Sending churches explicitly want task checklists to assess readiness; phase-triggered import (T-020) becomes possible once P1-1 ships. | large |
| P2-3 | **Coaching engagement workspace** — session logs, shared action items (materialize as F5 tasks), pre-session digest. Also fix: coach role currently has NO working landing page (falls through to single-church /dashboard). | Coaching is the single biggest survival lever in the research (86–90% vs ~68% survival), and coaches today get read-only nothing. Cheap, differentiating, and serves Bryan/Brett's actual workflow. | medium |
| P2-4 | **Public plant micro-site + interest forms** — public landing page + QR/shareable form → creates F2 prospects with source attribution | Closes the loop on Phase 1's literal job ("grow core group via invitations"); every page is an acquisition surface. RSVP-token public page proves the pattern. | medium |
| P2-5 | **Donor / support-raising pipeline (pre-F7 or as F7 phase 1)** — prospective supporters, asks, pledges, monthly partners, pledge-vs-received; supporter update broadcasts via F9 | The research's most acute unaddressed planter pain: funding is raised in Phases 0–2 *before* internal giving exists; 33% consider quitting over finances. No competitor serves pre-launch support raising. Consider building this *before* classic F7 budgeting — it matches where beta planters actually are. | large |
| P2-6 | **Multi-user church accounts** — co-planter/spouse, admin assistant, team-leader seats | Team leaders can be assigned tasks but can never log in. Each seat is a retention anchor. Depends on P1-7. | large |
| P2-7 | **Audit log + soft-delete/recycle bin + per-church snapshot export** | Trust infrastructure: oversight adoption, F7 prerequisite, forensic backstop for P0-1; "it lost my people" is an unrecoverable beta failure. | medium |
| P2-8 | **Product analytics instrumentation** (PostHog) — activation funnel, feature adoption, zero-result wiki searches | The team currently cannot answer "did anyone use meetings this week?" A small beta produces no learning without it. | small |
| P2-9 | **F7 Financial Tracking phase 1** (giving entry, budget, expenses, budget-vs-actual) | Needed for the Giving CSF and runway metrics, but manual entry will rot — pair with a giving-platform sync (Tithe.ly/Stripe read-only) or CSV import from day one. | large |
| P2-10 | **Child-safety / background-check tracking** on F2/F8 + Children's-team readiness gate | Competitor table stakes (PCO↔Checkr), legal/insurance necessity for launch, and a credibility item churches will check. | medium |

### P3 — Strategic / long-term (post-beta; needs FRDs)

1. **Network planter-candidate pipeline** (inquiry → assessment → cohort → endorsement → plant created) — directly attacks the #1 network pain ("pipeline has dried up") and moves EveryField upstream; networks are the buyer with money (ARC $100K/plant, NAMB $70M+/yr). The strongest "stay for the network" wedge.
2. **Network-sponsored seats & billing** — bulk cohort provisioning, network-paid accounts (gap.md item 11; the B2B2C economics depend on it).
3. **Anonymized cross-plant benchmarking** ("plants at your stage average 38 core adults; you're at 22") — the execution of the brainlift's "data backbone" thesis; the only feature no competitor can copy. Already a resolved product-brief decision with no FRD.
4. **Methodology configurability** — exit criteria, phases, and terminology per network. The research calls one-size-fits-all the strongest failure mode for serving 45–60+ networks. Design the Phase Engine (P1-1) with criteria-as-data so this is a config layer later, not a rewrite.
5. **AI layer (chat-first ops + RAG coaching)** — the app-summary's stated direction; zero code exists. RAG over the 90-article wiki + phase-aware prompts is the natural first slice (pgvector or managed embeddings; wiki FTS infra is solid).
6. **Planter/spouse well-being check-ins** (privacy-first, opt-in coach sharing) — attrition is a burnout problem, not just a knowledge problem (35% marital strain).
7. **Prayer ministry tracking** — GROW/PRAY/GIVE is the methodology's core triad; PRAY (CSF #5) has zero representation.
8. **Core-group member self-service portal + volunteer scheduling PWA** — blocks the predictable Phase 3–4 defection to Planning Center; multiplies accounts per plant 1→50–100.
9. **Guided migration wizard** (PCO/Breeze/Mailchimp/spreadsheet import + phase backfill) — most of the 12–20K active plants are mid-journey; cold start is the adoption killer.
10. **Multiplication/generational tree tracking** (Phase 6 has no feature; the movement's aspirational metric).
11. **Guided legal formation workflow** (state-aware incorporation, 501(c)(3) 27-month deadline, insurance) — most predictable planter failure zone; Stadia's differentiator.
12. **Offline mobile meeting check-in (PWA)**, SMS (Twilio), Planning Center sync, Facility Management F10, top-down visibility model, campus planter model — per gap.md, still deferred.

---

## 4. Blind Spots — Features Not in Any FRD (summary table)

| Idea | Lens | Horizon | One-line value case |
|---|---|---|---|
| Donor/support-raising CRM | domain+market (both flagged independently) | medium | Funding is the #1 plant-killer; raised in Phases 0–2 before F7's internal giving exists; no competitor covers it |
| Coaching engagement workspace | domain | **near** | Biggest survival lever in research (86–90% vs 68%); coaches currently get read-only nothing |
| Prayer ministry tracking | domain | **near** | The untracked third of GROW/PRAY/GIVE; CSF #5; Prayer Leader is a named role |
| Public micro-site + interest forms | market | **near** | Turns real-world invitations into pipeline records; branded acquisition surface |
| Free Phase-0 discovery toolkit (self-assessment, cost estimator) | market | **near** | The already-decided free-tier hook ("Free: Wiki + Phase 0 tools") that was never specced |
| Onboarding wizard + phase self-assessment | product-ops | **near** | Nothing sets current_phase today; activation depends on first-session value |
| Playbook-grounded empty states (+demo church) | product-ops | **near** | Empty states are the first coaching surface for a day-zero planter |
| Notification infra + weekly digest | product-ops | **near** | Shared layer unblocking 4 FRD gaps; outbound retention for bivocational planters |
| Activation analytics + beta instrumentation | product-ops | **near** | Makes a small beta produce learning |
| Beta mechanics (flags, invite gating, changelog) | product-ops | **near** | Controlled, interviewable cohort |
| Child-safety/background checks | domain+market | medium | Legal/insurance necessity; competitor table stakes |
| Planter/spouse well-being check-ins | domain | medium | Attrition is burnout; platform measures church health, not planter health |
| Legal formation & insurance workflow | domain | medium | Most predictable planter failure zone (1023 deadlines, uninsured portable ops) |
| Giving-platform sync (Tithe.ly/Stripe) | market | medium | Manual giving entry will rot; trustworthy runway math |
| Member portal + serving schedules (PWA) | market+domain | medium/long | Blocks PCO defection at Phase 3–4; 50–100 accounts per plant |
| Migration wizard (PCO/Breeze/CSV) | market | near/medium | Mid-journey planters are the real market; kills cold start |
| Multi-user church accounts | product-ops | medium | Team leaders can't log in; seats = retention |
| Audit log, soft-delete, account lifecycle (transfer/disaffiliate/GDPR) | product-ops | medium | Oversight trust + the unhappy paths a real beta will hit |
| Offline mobile check-in PWA | product-ops | medium | Attendance (highest-value data) is captured offline in living rooms |
| Candidate pipeline for networks | domain+market | long | #1 network pain; upstream wedge; second product |
| Cohort benchmarking ("plants like yours") | market | long | The data-backbone thesis; uncopyable moat |
| Multiplication tree tracking | domain | long | The movement's end-state metric; Phase 6 is featureless |
| Volunteer ops & equipment registry | domain | long | Post-launch survival (years 1–4 is where the survival curve drops) |

**Strategic-gap headline from the docs analysis:** the doc set is a strong *planter-tool* spec, but the "stay for the network" half of the stated strategy (brainlift SPOV 3) exists only in research docs — networks/sending churches/coaches have no workflow features, only dashboards and invitations. The research also warns the methodology is hard-coded to one playbook ("a platform that ignores [configurability] will fail regardless of how good the technology is") and that positioning must be "data-informed, faith-driven" — neither is reflected in any FRD.

---

## 5. Prioritization Reasoning

1. **Trust before features (P0).** The immediate milestone is Brett introducing real planters. A possible unauthenticated API surface, unthrottled auth, write-only feedback, and reachable dead code are cheap to fix and catastrophic to ignore. Nothing else matters if the beta breaks trust.
2. **Unblock the dependency keystone (Phase Engine first).** One missing service blocks five other committed features and both external validators (Brett/Bryan) are waiting on exit criteria. Highest leverage-per-effort in the backlog.
3. **Activation and retention beat breadth (onboarding, digest, empty states).** Beta value is measured in second sessions, not feature count. A mid-journey planter must see their real situation reflected in minutes.
4. **Serve the buyer's stated value (oversight metrics).** "Reduce time chasing planter updates" was the sending churches' core ask; the oversight page showing phase counts only — and admins being unable to even invite planters — is the gap between demo and sale.
5. **Sequence money features by where planters actually are.** Beta planters are Phases 0–2: support-raising (external funding) precedes congregational giving. Building classic F7 first would track money beta users don't have yet.
6. **Quick wins are disproportionately valuable now.** Nine small items (P1-6) close Must Have FRD gaps and meeting commitments in days; they also fix data being silently lost today (attendance types) which can never be backfilled.
7. **Defer what has no near-term consumer.** F10 facilities, SMS, PCO sync, campus model, top-down visibility — unchanged from gap.md's reasoning; nothing in the meeting or research elevates them.
8. **Design P1 work for P3 strategy.** Phase Engine criteria as data (→ network configurability), audit/events everywhere (→ benchmarking data backbone), candidate-pipeline-aware church creation (→ upstream wedge). Cheap now, expensive to retrofit.

---

## 6. Suggested Delivery Sequence

```
Sprint A (pre-beta hardening, ~1 wk)
├── P0-1 API audit/lockdown        ├── P0-4 invite gating + nav cleanup
├── P0-2 rate limit + Sentry       ├── P0-5 delete legacy vision-meetings
├── P0-3 feedback admin view       ├── P0-6/7 F8 constraint + attendance_type bugs
└── Send draft phase exit criteria to Brett & Bryan (unblocks Sprint B)

Sprint B (foundations, ~2-3 wks)
├── P1-1 Phase Engine (soft gating, criteria-as-data, phase.changed)
├── P1-2 Onboarding wizard + launch_date column
├── P1-6 quick-wins batch
└── P2-8 PostHog instrumentation (cheap, do early)

Sprint C (visibility, ~2-3 wks)
├── P1-3 Dashboard wave 2 (stepper, criteria, countdown, partial CSF)
├── P1-4 Oversight metrics + invitation UI fix
├── P1-5 Cron + notifications + weekly digest
└── P1-7 F8 authorization

Beta period (parallel tracks)
├── P2-1 Documents phase 1 → P2-2 checklist templates/milestones
├── P2-3 Coaching workspace → P2-4 public micro-site
├── P2-5 Support-raising pipeline (before classic F7)
└── P2-7 audit log/soft-delete · P2-6 multi-user · P2-10 background checks

Post-beta: P3 by strategic appetite (network pipeline + benchmarking first
if pursuing the B2B2C thesis; AI/RAG layer when phase engine data exists)
```

---

## 7. Documentation Cleanup Actions

- Mark feature checklists stale or regenerate from code (F2, F3, F5, F8 badly out of date; F3's still describes pre-unification architecture).
- Record in product-brief Resolved Decisions: reasons required for ALL manual status changes (shipped beyond spec); inactivity thresholds church-configurable.
- Add FRDs (or FRD sections) when prioritized: coaching workspace, support-raising, onboarding, notifications, candidate pipeline.
- Update gap.md header noting it is superseded by this report for implementation status.
- Translate the research's "data-informed, faith-driven" positioning requirement into product-brief language (currently absent from all requirements docs).
