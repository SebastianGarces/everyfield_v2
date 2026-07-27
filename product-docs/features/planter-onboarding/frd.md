# F12: Planter Onboarding
## Feature Requirements Document (FRD)

**Version:** 1.0
**Date:** July 27, 2026
**Feature Code:** F12

---

> **Tracked on the board:** [F12 #184](https://github.com/SebastianGarces/everyfield_v2/issues/184) — open requirements become its sub-issues once this FRD is accepted. Implementation status is not tracked in this file.

## References

- [Product Brief](../../product-brief.md) — target users, phase structure, "all relationships optional and mutable"
- [System Architecture](../../system-architecture.md) — tenancy model, Church as a shared entity
- [Alpha plan of record](../../alpha-release-2026-07.md) — why this is alpha-blocking (§2, §3)

---

## Overview

Onboarding is the guided flow a planter goes through when creating their church, capturing the minimum facts that make the rest of the product adapt to where the plant **actually** is. Today church creation captures one field (the name); every plant starts at phase 0 with no launch date and no location, which is wrong for most real planters — alpha users arrive mid-journey, from "just discerning" to "weeks from launch Sunday."

The flow has one job: after ~3 minutes, the platform knows *who leads the plant, where it is, when it hopes to launch, and what stage of the journey it is in* — and the planter knows the fastest path to value (import your people, read your phase's guidance).

Onboarding is a **church-creation-time flow, not a wizard prison**: every step after the name is skippable, the flow is resumable, and everything captured here is editable later in church settings.

### Design principles

1. **Declare, don't fabricate.** A planter who is mid-journey sets their current phase directly. The system must never require (or synthesize) a fictional 0→N progression history to get there.
2. **Safe defaults, explicit confirmation.** The first account on a church is assumed to be the planter/pastor (ruling 2026-07-26, issue #157) — but the flow asks rather than silently assuming, because the no-planter state silently degrades downstream behavior (e.g. follow-up task generation).
3. **Skippable is not optional-forever.** Skipped facts leave visible, dismissible nudges where their absence hurts.

---

## User-Visible Behavior

- A planter with no church sees the onboarding flow as the primary dashboard content (replacing today's single-field create-church card).
- Completing (or skipping through) the flow lands on the normal dashboard, adapted to the declared phase — wiki filtered to that phase, phase label in the header, phase-appropriate guidance.
- A planter who abandons mid-flow resumes where they left off on next visit; the church exists from step 1 onward, so nothing is lost.
- A planter who answers "no" to the pastor question sees a persistent, dismissible-per-session banner on the dashboard until a planter is assigned.

---

## Screens & Workflow

One flow, four steps. Step 1 creates the church; steps 2–4 update it.

### Step 1 — Church basics *(only required step)*

- Church plant name (required, ≤255 chars — existing validation)
- Location: city, state/region, country (each optional)

### Step 2 — Leadership

- "Will you be the lead planter/pastor of this church plant?" — default **Yes**.
- **Yes** → the creating account is recorded as the church's planter.
- **No** → the church is created with no planter assigned; the flow explains what that limits (e.g. follow-up tasks need an assignee) and the dashboard shows a "no planter assigned" nudge. Assigning someone else requires user invitations (separate feature); until then the nudge links to this step to change the answer.

### Step 3 — Where are you in the journey?

- Target launch date: a date, or an explicit "no date yet."
- Journey stage: a picker of the seven phases described in plain language (from the Product Brief's phase table — "Discovery: discerning the calling…" through "Post-Launch"), not raw phase numbers. Includes "not sure — start me at the beginning" (→ phase 0).
- Selecting a stage sets the church's current phase **as an initial declaration**: recorded in phase history as a declaration, distinguishable from a real transition, with no intermediate transitions synthesized.

### Step 4 — Bring your people

- Entry point to the existing CSV import wizard (template download, preview, duplicate detection) and to quick-add for one-at-a-time entry.
- Copy explains what import unlocks (pipeline, meetings attendance, follow-ups).
- Skippable; the People page remains the permanent home of import.

### Finish

- Lands on the dashboard with `?churchCreated=true` (existing confetti preserved).
- The plant is marked dirty for the phase engine so the first assessment happens promptly rather than waiting up to 24h for the daily cron.

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement |
|----|-------------|
| OB-001 | Multi-step onboarding flow replaces the single-field create-church card; the church is created at step 1 and steps 2–4 are updates, so abandonment never loses the church. |
| OB-002 | Capture location (city, state/region, country — all individually optional) stored on the church. |
| OB-003 | Capture target launch date or an explicit "no date yet"; the stored date feeds the existing launch-countdown and document merge fields. |
| OB-004 | Pastor confirmation with default Yes; Yes records the creating account as the church's planter; No leaves the church in an explicit no-planter state with a persistent dashboard nudge. |
| OB-005 | Journey-stage declaration sets `current_phase` directly, recorded as an initial declaration distinct from a transition; no fabricated history. |
| OB-006 | Step 4 surfaces the existing CSV import wizard and quick-add without duplicating them. |
| OB-007 | Every step after step 1 is skippable; the flow is resumable at the first incomplete step. |
| OB-008 | Everything captured is editable later in church settings (settings surface is a separate feature; this FRD only requires that no onboarding answer is permanent). |

### Should Have

| ID | Requirement |
|----|-------------|
| OB-009 | Completing onboarding marks the plant for prompt first assessment (dirty flag), so `/phase` is not cold for a day. |
| OB-010 | Existing churches created before this feature that have no planter assigned get a one-time pastor-confirmation prompt (the #157 open question, answered: yes, one-time and dismissible). |
| OB-011 | An incomplete-onboarding indicator on the dashboard (dismissible) listing skipped steps, linking back into the flow. |

### Nice to Have (Future — no board issues; spec only)

| ID | Requirement |
|----|-------------|
| OB-012 | Stage-tailored finish screen: 2–3 wiki links chosen by declared phase. |
| OB-013 | A short guided self-assessment that *suggests* a stage instead of asking for a direct pick. |

---

## Acceptance Criteria

1. A new planter completing all four steps ends with a church carrying name, location, launch date, a declared phase, and themselves as planter — and the dashboard header, wiki filter, and phase page all reflect the declared phase with zero manual phase transitions performed.
2. A planter who skips everything after step 1 gets exactly today's outcome (named church, phase 0, no date) plus the incomplete-onboarding indicator.
3. Declaring phase 3 at onboarding produces **no** transition records for phases 1–2, and phase history visibly distinguishes "declared at setup" from later real transitions.
4. Answering "No" to the pastor question: meetings can still be finalized (existing no-planter behavior), and the dashboard shows the no-planter nudge until resolved.
5. Abandoning after step 2 and returning resumes at step 3, with steps 1–2 answers intact.
6. The launch-countdown surface shows the declared date immediately after onboarding; documents generated afterward merge the real launch date instead of a blank.
7. All flow controls are keyboard-accessible and every clickable element has `cursor-pointer`.

---

## Data Entities

Church is a shared entity (System Architecture); fields below are additive and nullable.

- **Church**: + `city`, `state_region`, `country` (nullable text). `launch_date` already exists — this feature adds its first write path. + a way to know onboarding completion state (e.g. `onboarding_completed_at` nullable timestamp; step resumption may be derived from which facts are null rather than stored per-step).
- **Planter assignment**: recorded with the existing mechanism (`users.church_id` + role); OB-004 adds no new entity but makes the assignment explicit and queryable ("does this church have a planter?").
- **Phase history**: the initial declaration must be distinguishable from transitions (e.g. a distinguished transition kind or reason constant on the existing phase-transition record). No new table expected.

Schema changes ⇒ requirement issues carrying them are `risk:high` per board convention.

---

## Integration Points

- **Phase engine**: initial declaration sets the phase the judge scores against; completion marks the plant dirty for prompt first assessment. Declaration must not distort transition-history-based analytics.
- **People/CRM**: step 4 links to the existing import wizard and quick-add; no duplication.
- **Documents & countdown surfaces**: consume `launch_date` (already read; currently always null).
- **Oversight**: declared phase appears wherever current phase already appears; no new oversight surface.
- **Church settings** (separate feature): the permanent edit surface for everything captured here.

---

## Non-Functional Requirements

- The happy path (all four steps) completes in under 5 minutes with no data prepared in advance.
- Mobile-responsive; the flow is usable on a phone.
- Each step commits independently (no giant final submit); a failure on one step's save never loses prior steps.

---

## Success Metrics

- % of new churches completing all four steps (target: >70% of alpha cohort)
- % of new churches declaring a non-zero phase (validates the feature's premise)
- % importing ≥1 person during onboarding
- Median time from church creation to first meaningful action (person added, meeting scheduled)

---

## Open Questions

1. **Location granularity** — is city/state/country enough for alpha, or does SEND reporting want anything more (region groupings)? (Timezone is deliberately excluded: it is its own decision, issue #166.)
2. **"No" to pastor, long-term** — once user invitations exist, should the No path immediately offer "invite the pastor"? (Alpha ships the nudge only.)
3. **Should OB-010's one-time prompt also cover churches whose planter exists but was never explicitly confirmed?** Current assumption: no — implicit assignment via existing `users.church_id` + role is treated as confirmed.
