# EveryField - Meeting Gap Analysis

**Date:** February 2026
**Meeting Participants:** Sebastian Garces, Brett Stiles, Bryan Nass
**Purpose:** Compare meeting discussion against product documentation (PRD + 10 FRDs) and actual codebase implementation to identify gaps, new decisions, and priorities.

---

## How to Read This Document

Each gap section follows a consistent format:

- **Meeting Discussion** -- what was discussed in the meeting
- **Documentation Status** -- what the PRD/FRDs already specify
- **Implementation Status** -- what is actually built in the codebase
- **Gap** -- what is missing or inconsistent
- **Suggested Approach** -- how to address the gap

---

## Implementation Baseline

Before diving into gaps, here is the current state of the platform as of this analysis.

### Fully Implemented (routes + schema + service layer)

| Feature | Code | Key Capabilities |
|---------|------|------------------|
| Wiki / Knowledge Base | F1 | Articles, sections, progress tracking, bookmarks, search, phase-based recommendations |
| People / CRM | F2 | Person CRUD, pipeline view, status auto-progression, assessments (4 C's), interviews, commitments, activity timeline, tags, households, CSV import, duplicate detection |
| Meetings | F3 | Unified meetings (vision, orientation, team), attendance, guest list, RSVP tokens, evaluations, materials checklists, analytics, email invitations via F9 |
| Ministry Teams | F8 | Teams dashboard, roles, memberships, training matrix, health metrics, org chart, role templates for all 10 core teams |
| Communication Hub | F9 | Email composition, templates with merge fields, Resend delivery tracking (sent/delivered/opened/clicked), recipient status, message history |

### Partially Implemented

| Area | Status | What Exists | What Is Missing |
|------|--------|-------------|-----------------|
| Progress Dashboard (F4) | Scaffold only | `/dashboard` route (mostly church creation flow), `/oversight` route (basic planter list by phase) | Comprehensive metrics, phase progress visualization, 8 CSF scorecard, growth velocity, coach dashboard |
| Phase Engine | Constants only | Phase constants (0-6) defined in `src/lib/constants.ts`. `current_phase` column exists on churches table. | No transition logic, no exit criteria validation, no readiness indicators, no phase change events |
| Event System | Partial | In-process event bus with active subscriptions: `meeting.attendance.recorded` -> auto-advance person status, `team.member.assigned/leader.assigned` -> auto-advance person status | Deferred subscriptions: follow-up task creation from attendance finalization, dashboard metric updates, welcome workflows |

### Not Implemented (zero code)

| Feature | Code | FRD Status |
|---------|------|------------|
| Task & Project Management | F5 | Full FRD exists -- no schema, routes, or service |
| Document Templates & Generation | F6 | Full FRD exists -- no schema, routes, or service |
| Financial Tracking | F7 | Full FRD exists -- no schema, routes, or service |
| Facility Management | F10 | Full FRD exists -- no schema, routes, or service |
| SMS Integration | -- | Referenced in system architecture -- no implementation |
| Planning Center Integration | -- | Referenced as future in F2 and system architecture -- no implementation |

### Core Infrastructure (Implemented)

- **Authentication:** Session-based (Argon2id password hashing, httpOnly cookies, 30-day sessions with 15-day sliding window)
- **Roles:** `planter`, `coach`, `team_member`, `sending_church_admin`, `network_admin`
- **Multi-tenancy:** Application-layer `church_id` scoping on all feature data
- **Invitations:** Full invitation system for associating churches, sending churches, and networks
- **Signup:** Three independent paths (planter, sending church admin, network admin)
- **Privacy:** Per-feature privacy toggles (`share_people`, `share_meetings`, `share_tasks`, `share_financials`, `share_ministry_teams`, `share_facilities`), all default false
- **File Storage:** S3-compatible storage with signed URLs
- **Email:** Resend API with delivery tracking webhooks
- **Database:** PostgreSQL (Neon) + Drizzle ORM, 36 tables across 14 migrations

---

## Tier 1 Gaps -- Near-Term Priorities

These gaps were explicitly discussed in the meeting as upcoming priorities or active needs.

---

### 1. Pipeline Visual Indicators and Manual Status Reasons

**Feature:** F2 People/CRM
**Priority:** Near-term (Brian's direct feedback)

**Meeting Discussion:**
The system automatically updates people's status based on actions like attending vision meetings or signing commitments. Manual status changes are allowed but should require users to provide reasons when skipping steps or moving backward. Brian specifically requested enhanced visual indicators on pipeline cards to flag inactivity or other alerts. The team also discussed adding note-taking capabilities for vision meeting attendees to capture qualitative information.

**Documentation Status:**
The F2 FRD defines event-driven automatic progression with manual override via drag-and-drop pipeline. The design philosophy states "Actions drive status, not manual selection" and "Manual override available for edge cases." No mention of requiring reasons for manual changes. No inactivity indicators described. No per-attendee note-taking during meetings.

**Implementation Status:**
`src/lib/people/status.ts` implements manual override with soft warnings (e.g., warning if recording an interview for someone who hasn't attended a vision meeting) but does NOT require reasons for backward or skip changes. Pipeline cards in the UI show basic person info and status badges but no inactivity flags. The `meeting_attendance` table has a `notes` column available but no dedicated per-attendee note-taking UX during attendance capture.

**Gap:**
1. No required reason field when manually moving a person backward or skipping pipeline stages
2. No visual inactivity indicators on pipeline cards (e.g., "no contact in 14 days")
3. No prominent per-attendee qualitative note-taking in the attendance capture flow

**Suggested Approach:**
1. Add a `status_change_reason` field to `person_activities` entries created by manual status changes. When a user drags a person backward or skips stages in the pipeline, require a reason before confirming. Forward auto-progressions do not need reasons.
2. Compute a "last activity date" per person (most recent activity in `person_activities`) and display inactivity badges on pipeline cards when the threshold exceeds a configurable number of days (e.g., 7 or 14 days). Use a yellow/red visual indicator.
3. Surface the existing `notes` field on `meeting_attendance` more prominently in the attendance capture screen. Add a notes icon/button per attendee row that opens a text input.

---

### 2. Phase Engine

**Feature:** Cross-cutting (System Architecture)
**Priority:** Near-term (foundational for task management, dashboard, and sending church visibility)

**Meeting Discussion:**
The app features phases to auto-track planter progress through actions in the system instead of manual updates. Currently the journey focuses heavily on building the core group and launch team stages. Exit criteria and phase gating are being designed but need to balance flexibility with guidance to accommodate non-linear progressions. Sebastian plans to refine phase descriptions and exit criteria with input from Brett and Bryan to align system logic with real planter needs.

**Documentation Status:**
The Phase Engine is documented in `system-architecture.md` with responsibilities (track `current_phase`, validate transition criteria, emit events, maintain audit log) and an exit criteria summary table covering transitions 0->1 through 5->6. The product brief defines six phases (0-6) with names and purposes. Phase exit criteria are described at a high level.

**Implementation Status:**
Phase constants (0-6) are defined in `src/lib/constants.ts`. The `churches` table has a `current_phase` column. However, there is NO Phase Engine service -- no transition logic, no exit criteria validation, no readiness computation, no `phase.changed` or `phase.criteria.updated` events. Phase is essentially a static label with no system behavior attached.

**Gap:**
The entire Phase Engine is unimplemented. This is a foundational gap because:
- Task Management (F5) depends on phase-triggered templates
- The Dashboard (F4) depends on phase progress and exit criteria display
- Sending church visibility depends on understanding planter readiness
- Wiki content recommendations depend on phase awareness (this works via the static label today)

**Suggested Approach:**
Build a Phase Engine service (`src/lib/phase-engine/`) with these principles:
1. **Soft gating** -- exit criteria are advisory, not blocking. The system shows readiness indicators (e.g., "5 of 7 exit criteria met") but allows manual phase advancement.
2. **Planter-initiated transitions** -- planters explicitly advance their phase via a UI action, not automatic advancement. The system provides prompts when criteria are met.
3. **Exit criteria as queries** -- each criterion maps to a database query (e.g., "30+ committed adults" = `COUNT(persons WHERE status IN ('core_group', 'launch_team', 'leader'))`) or a manual boolean toggle for criteria that can't be computed.
4. **Audit trail** -- log phase transitions with criteria snapshot, timestamp, and user.
5. **Events** -- emit `phase.changed` for subscribers (wiki recommendations, task templates, dashboard).
6. Collaborate with Brett and Bryan on refining exit criteria before implementing the validation queries.

---

### 3. Task & Project Management

**Feature:** F5
**Priority:** Near-term (explicitly discussed as upcoming priority, unblocks Phase Engine and sending church visibility)

**Meeting Discussion:**
Task lists tied to phases are planned to auto-populate essential steps for each stage, allowing manual additions. Visibility of task completion will help sending churches assess readiness before moving planters to subsequent phases or setting launch dates. The meeting emphasized this as a priority for supporting phases beyond the launch team.

**Documentation Status:**
A full FRD exists at `features/task-project-management/frd.md` specifying: task CRUD with title/due date/priority/status, task list view grouped by time period (overdue/today/this week), checklist templates by phase, GANTT timeline view, milestones, task dependencies, recurring tasks, phase-triggered template import, and integration contracts (subscribes to `phase.changed`, `meeting.attendance.finalized`; emits `task.completed`).

**Implementation Status:**
Zero implementation. No database tables (`tasks`, `checklists`, `milestones` not in schema). No routes under `/tasks`. No service module in `src/lib/`. The event subscription for `meeting.attendance.finalized` -> create follow-up tasks is defined in the event bus subscriptions file but marked as deferred.

**Gap:**
The entire feature is missing from the codebase. This is significant because:
- 48-hour follow-up task creation (a core meeting workflow) depends on this
- Phase exit criteria assessment depends on task completion visibility
- Sending churches want task checklists to assess planter readiness
- The deferred event subscription means attendance finalization currently does NOT create follow-up tasks

**Suggested Approach:**
Implement incrementally:
1. **Phase 1:** Schema (tasks table + migrations), core task CRUD, task list view at `/tasks`, "My Tasks" filter. Wire up `meeting.attendance.finalized` -> create follow-up tasks for new vision meeting attendees.
2. **Phase 2:** Checklist templates by phase. Phase-triggered template import prompt. Milestones.
3. **Phase 3:** Task dependencies, recurring tasks, GANTT/timeline view.
4. **Phase 4:** Oversight access patterns (aggregate task completion for sending churches).

---

### 4. Document Templates & Generation

**Feature:** F6
**Priority:** Near-term (discussed alongside task management as upcoming)

**Meeting Discussion:**
Documents for meetings, orientations, and training sessions will be provided as templates to standardize planter preparation. Future features will release new task templates and documents aligned with later phases like training and pre-launch planning.

**Documentation Status:**
A full FRD exists at `features/document-templates/frd.md` specifying: template library organized by category (commitment, vision meeting, administrative, operational, communication), merge field system, PDF/DOCX generation, document history, and contextual template access from other features.

**Implementation Status:**
Zero implementation. No database tables (`templates`, `documents` not in schema). No routes. No service. The wiki has a "Templates & Downloads" section in its content architecture, but this refers to wiki-level resources, not the document generation system.

**Gap:**
The entire feature is missing. Meeting positions it as important for supporting later phases (training, pre-launch) and standardizing planter preparation.

**Suggested Approach:**
Start lean:
1. **Phase 1:** Template library as a read-only catalog. Define templates in code (similar to role templates in F8). Display at `/documents` with category filtering and phase tagging.
2. **Phase 2:** PDF generation for high-priority templates (commitment card, guest sign-in sheet, vision meeting agenda). Use a server-side PDF library with merge fields from church profile.
3. **Phase 3:** Generated document history, DOCX export for editable templates, contextual access from other features.

---

### 5. In-App Feedback Mechanism

**Feature:** Cross-cutting
**Priority:** Near-term (explicit action item from meeting)

**Meeting Discussion:**
A feedback button will be added soon to collect user suggestions directly from the app. The current system has no gating -- testers can freely create accounts and explore features. Sending churches expressed interest in trialing the app with their planters to gather real-world feedback.

**Documentation Status:**
Not mentioned in any FRD. No product documentation exists for a feedback mechanism.

**Implementation Status:**
Not implemented. No feedback collection system exists.

**Gap:**
No way for beta testers to submit feedback, suggestions, or bug reports from within the app. With Brett planning to introduce planters for testing, this is needed before broader user exposure.

**Suggested Approach:**
Lightweight cross-cutting implementation (not a full FRD):
1. Floating feedback button (bottom-right corner) visible on all authenticated pages.
2. Simple form: text description, category (bug/suggestion/question), auto-captured page URL and user context.
3. Submissions either (a) stored in a `feedback` table and viewable in an admin view, or (b) sent directly to email. Option (a) preferred for tracking.
4. Optional: screenshot capture using browser APIs.

---

## Tier 2 Gaps -- Medium-Term Priorities

These gaps are important but depend on Tier 1 work or represent expansions of existing functionality.

---

### 6. Progress Dashboard Expansion

**Feature:** F4 Progress Dashboard
**Priority:** Medium-term (depends on F5 for task metrics, Phase Engine for progress display)

**Meeting Discussion:**
Metrics and progress tracking were referenced throughout the meeting. Sending churches want visibility into planter readiness. The dashboard should help reduce time spent chasing planter updates and streamline communication and decision-making.

**Documentation Status:**
A full FRD exists at `features/progress-dashboard/frd.md` with wireframes for: main dashboard (phase progress, Core Group size, launch countdown, 8 CSFs, recent activity, quick actions), phase progress detail, core metrics dashboard, 8 CSF scorecard, launch countdown, and coach dashboard.

**Implementation Status:**
`/dashboard` exists but is mostly a church creation flow for new planters. No phase progress visualization, no Core Group size metric, no 8 CSF scorecard, no recent activity feed, no growth velocity. The `/oversight` route shows a basic list of church plants by phase but no aggregated metrics.

**Gap:**
Nearly the entire F4 FRD is unimplemented. This is the largest gap between documentation and code for any implemented feature area (since the route exists but has almost no FRD-specified content).

**Suggested Approach:**
Implement incrementally as dependencies come online:
1. **Now (no dependencies):** Phase progress bar showing current phase + visual timeline. Core Group size metric (query persons by status). Recent activity feed (from `person_activities`). Quick action links.
2. **After Phase Engine:** Phase exit criteria progress display with completion percentage.
3. **After F5 Tasks:** Overdue task count, task completion rates.
4. **After F7 Financial:** Giving metrics.
5. **Coach dashboard:** Multi-planter view once planter dashboards have meaningful content.

---

### 7. Sending Church / Network Dashboard

**Feature:** F4 (Oversight extension)
**Priority:** Medium-term (depends on dashboard metrics and privacy controls)

**Meeting Discussion:**
Sending churches want a dashboard showing all their planters with key metrics like vision meeting attendance, committed people, and filled ministry roles. This visibility helps them prepare for resource shifts, like team members leaving to plant churches. Task checklists and status overviews will reduce time spent chasing planter updates.

**Documentation Status:**
The F4 FRD defines oversight access patterns for coach, sending church admin, and network admin roles. Each feature FRD defines what aggregate metrics are visible to oversight users. However, there are no dedicated wireframes for sending church or network dashboards -- only a coach dashboard wireframe.

**Implementation Status:**
`/oversight` route exists with a basic planter list organized by phase. The privacy settings infrastructure is fully implemented (`canAccessFeatureData()`, per-feature toggles). But no aggregated metrics, no VM attendance trends, no Core Group counts, no ministry team staffing overview.

**Gap:**
No dedicated portfolio dashboard for sending churches or networks. The `/oversight` route is a starting point but needs significant expansion to deliver the visibility sending churches described in the meeting.

**Suggested Approach:**
Expand the `/oversight` route to show:
1. Plants organized by phase with visual phase indicators
2. Per-plant summary cards: Core Group count, last activity date, current phase, health status
3. Aggregate metrics across portfolio: total Core Group members, plants on track vs. at risk
4. Feature-specific metrics (each respecting privacy toggles): VM attendance trends, task completion (once F5 built), ministry team staffing percentages
5. Add wireframes for these views to the F4 FRD

---

### 8. Data Export and Portability

**Feature:** Cross-cutting (primarily F2)
**Priority:** Medium-term

**Meeting Discussion:**
Planters can export their data (CSV) to migrate to their own systems after launch. This was discussed as an important capability for planters transitioning to their own church management software post-launch.

**Documentation Status:**
P-027 in F2 lists "Bulk export" as Nice to Have. FIN-018 in F7 lists "Export to CSV" as Should Have. No cross-feature data export strategy exists.

**Implementation Status:**
CSV import exists for People (`src/lib/people/import.ts`). No CSV export capability anywhere in the codebase.

**Gap:**
No export capability in any feature. The meeting explicitly discussed data portability as important for planter autonomy. Currently a planter has no way to extract their data from the platform.

**Suggested Approach:**
1. Elevate P-027 (People export) from Nice to Have to Should Have.
2. Implement CSV export for People (F2) first -- this is the most valuable data for planters migrating to a ChMS. Server action that queries all persons for a `church_id` and returns formatted CSV.
3. Add export to other features as they are implemented (tasks, financial data).
4. Consider adding a "Data Export" section to system-architecture.md defining the cross-feature export contract.

---

### 9. Wiki Network-Level Customization

**Feature:** F1 Wiki
**Priority:** Medium-term (post-MVP)

**Meeting Discussion:**
A 78-page launch playbook was converted into 90+ AI-generated wiki articles. Ongoing human review ensures biblical accuracy and coherence. Sending networks can add or exclude wiki articles to tailor content to their unique vision and terminology, preventing generic mismatches.

**Documentation Status:**
The F1 FRD supports `church_id` scoping on `WikiArticle` (null = global/platform-wide, value = church-specific). W-024 "Network customization" is listed as Nice to Have. A resolved decision notes that the schema already supports church-level customization.

**Implementation Status:**
The `wiki_articles` table has a `church_id` column (null for global articles). No `sending_network_id` field exists. There is no mechanism for networks to add network-specific articles or exclude global articles for their planters.

**Gap:**
1. No network-level article scoping (articles can be global or church-specific, but not network-specific)
2. No ability for networks to exclude global articles they disagree with or find irrelevant
3. The meeting describes a use case (tailoring content to network vision/terminology) that the current schema cannot support

**Suggested Approach:**
1. Add optional `sending_network_id` to `wiki_articles` for network-scoped content. Query pattern becomes: `WHERE church_id IS NULL OR church_id = :church_id OR sending_network_id = :network_id`
2. For exclusions, add a `wiki_article_exclusions` table with `(sending_network_id, article_id)` pairs. Filter these out in article queries for planters within that network.
3. Keep as post-MVP. The current 90+ global articles serve all users well initially.

---

## Tier 3 Gaps -- Deferred / Long-Term

These gaps were discussed in the meeting but are explicitly deferred or represent long-term vision items.

---

### 10. Top-Down Data Visibility Model

**Feature:** Core Architecture (Privacy)
**Priority:** Deferred

**Meeting Discussion:**
Currently, planters control what data (people, commitments) is shared upward to sending churches. Discussion included a potential top-down model where sending churches set visibility rules, especially useful for networks overseeing multiple planters. Sending churches envision owning and paying for accounts, provisioning access to planters during preparation phases.

**Documentation Status:**
The current model is planter-controlled per-feature privacy toggles in `ChurchPrivacySettings`, documented in core-data-contracts.md. All toggles default to false (opt-in sharing). The product brief's resolved decisions confirm "Per-feature privacy controls: Planters control visibility at the feature level."

**Implementation Status:**
Fully implemented as planter-controlled. `church_privacy_settings` table with six boolean toggles. `canAccessFeatureData()` function checks these toggles before returning data to oversight users. All working as documented.

**Gap:**
No alternative model where sending churches can set or override visibility rules. The meeting acknowledged this as a future consideration, not an immediate need.

**Suggested Approach:**
Document as a deferred decision in `product-brief.md` Resolved Decisions:
- Current model: planter-controlled (bottom-up). Ships first. Respects planter autonomy.
- Future model: sending church-controlled (top-down). Would require a `privacy_mode` enum (`planter_controlled` / `sending_church_controlled`) on `church_privacy_settings`. When sending-church-controlled, the sending church admin sets the toggles instead of the planter.
- Trade-offs: Bottom-up builds trust with planters. Top-down gives sending churches the control they expect when funding the plant.
- Decision needed: Validate with planters whether top-down control is acceptable when the sending church is funding the account.

---

### 11. Sending Church Account Ownership and Provisioning

**Feature:** Core Architecture (Billing/Accounts)
**Priority:** Deferred

**Meeting Discussion:**
Sending churches envision owning and paying for accounts, provisioning access to planters during preparation phases. Planters can export their data to migrate to their own systems after launch.

**Documentation Status:**
The product brief defines three independent signup paths. Pricing model: "Free: Wiki + Phase 0 ideation tools. Paid: Create a church, unlock all features." No concept of sending church paying on behalf of planters.

**Implementation Status:**
Three signup paths implemented. No billing system exists. Each user creates their own account independently.

**Gap:**
No concept of sending church-paid accounts, seat management, or account provisioning. This is a billing/business model gap more than a product feature gap.

**Suggested Approach:**
Document as a future billing model consideration:
- **Option A:** Sending church subscription with seat allocation. SC admin creates planter accounts and assigns seats. Planter can later detach and create their own paid account.
- **Option B:** Sending church purchases "planter licenses" as codes/links. Planter uses the code during signup for a pre-paid account.
- **Option C:** Sending church is billed monthly per active planter they've invited.
- All options require: account ownership transfer mechanics, data retention on transfer, billing integration.
- Defer until billing system is designed.

---

### 12. Campus Planter Model

**Feature:** Core Architecture (Church Entity)
**Priority:** Deferred (needs validation)

**Meeting Discussion:**
The app supports both fully autonomous planters and campus planters who remain under the sending church umbrella with common processes. Sending churches expressed a need to guide planters through steps in sequence, while allowing flexibility for out-of-order progress.

**Documentation Status:**
The product brief documents the hierarchical model (Network -> Sending Church -> Church Plant) with optional and mutable relationships. No distinction between autonomous and campus plants.

**Implementation Status:**
The `churches` table has `sending_church_id` and `sending_network_id` (both nullable) but no `plant_type` field. All church plants are treated identically regardless of their relationship to a sending church.

**Gap:**
No way to distinguish autonomous church plants from campus plants. Campus plants may need: stricter data sharing defaults (more visible to sending church), different phase progression (may skip certain phases), continued integration with sending church systems post-launch.

**Suggested Approach:**
Document as an open question for validation with Brett and Bryan:
- Would a `plant_type` enum (`autonomous` / `campus`) on the `churches` table be useful?
- How does campus planting differ from autonomous planting in terms of data sharing, phase progression, and post-launch behavior?
- Should campus plants have different default privacy settings (more open to sending church)?
- Defer implementation until the use case is validated.

---

### 13. Planning Center Integration

**Feature:** External Integration
**Priority:** Post-MVP (elevated from Nice to Have based on meeting)

**Meeting Discussion:**
Brett and Sebastian are actively exploring integrating with Planning Center to sync service plans and data automatically. The API documentation was found lacking, requiring trial and error to correctly identify unique IDs and call formats. Sebastian has experience building integrations with Planning Center for event and contact management. This was discussed as a collaboration opportunity.

**Documentation Status:**
P-026 "External ChMS sync" is listed as Nice to Have in F2. System architecture lists ChMS (Planning Center, Breeze) as an external integration with API integration type.

**Implementation Status:**
No Planning Center integration code exists. No ChMS integration of any kind.

**Gap:**
The meeting suggests higher priority than "Nice to Have" positioning. Active exploration is happening outside the platform. Key challenges identified: API documentation quality, unique ID identification, call format trial-and-error.

**Suggested Approach:**
1. Elevate to post-MVP priority in F2's requirements.
2. Define initial sync targets: (a) Read-only import of People/contacts from PCO into EveryField, (b) Bidirectional People sync (future).
3. Document known API challenges from Brett and Sebastian's exploration.
4. Start with a one-way import: PCO -> EveryField People. This gives planters already using PCO a migration path.
5. Service plan sync is a separate, later integration target.

---

### 14. Financial Tracking

**Feature:** F7
**Priority:** Deferred (full FRD exists, not discussed as near-term in meeting)

**Meeting Discussion:**
Not directly discussed in detail, but "giving" and "financial base" are referenced as part of phase exit criteria (Phase 1 -> 2 requires "financial base established") and as a metric sending churches want to see.

**Documentation Status:**
A full FRD exists at `features/financial-tracking/frd.md` with aggregate giving entry, giving units tracking, budget creation, expense recording, budget vs. actual comparison, financial projections, and runway calculations.

**Implementation Status:**
Zero implementation. No schema, no routes, no service.

**Gap:**
Entire feature missing. However, meeting priority is clearly on task management (F5) and document templates (F6) first. Financial tracking was not discussed as an upcoming feature.

**Suggested Approach:**
Defer to after F5 and F6 are implemented. For phase exit criteria that reference financial health (e.g., "financial base established"), use a manual boolean toggle in the Phase Engine until F7 is built. The 8 Critical Success Factor for "Generous Giving" can similarly use a manual input initially.

---

### 15. Facility Management

**Feature:** F10
**Priority:** Deferred (not discussed in meeting)

**Meeting Discussion:**
Not directly discussed. Facility search and management were not mentioned as a near-term concern.

**Documentation Status:**
A full FRD exists at `features/facility-management/frd.md` with venue pipeline, site visits, requirements checklist, photo attachments, comparison view, and contract tracking.

**Implementation Status:**
Zero implementation. No schema, no routes, no service.

**Gap:**
Entire feature missing. Lowest priority based on meeting discussion.

**Suggested Approach:**
Defer. When facility management becomes relevant (typically Phase 2+), implement starting with venue record CRUD and the requirements checklist. The existing `locations` table (from F3 Meetings) provides a partial foundation for venue data.

---

### 16. Matchmaking / Discovery Features

**Feature:** New (not in any FRD)
**Priority:** Long-term vision

**Meeting Discussion:**
Brett emphasized the challenge of finding planters and the potential for the platform to connect isolated planters with sending churches and networks. Long-term vision includes using the platform as a matchmaking and resource-sharing hub for church planting. Planters could start independently and later join networks, with permissions adapted accordingly.

**Documentation Status:**
The invitation system is documented (oversight invites, target accepts). Late association is supported. No discovery or directory features are documented.

**Implementation Status:**
The invitation system is fully implemented. Entities can be associated at any time. However, there is no way for a planter to discover available networks or sending churches -- they must receive an invitation.

**Gap:**
No discovery mechanism for connecting isolated planters with organizations. The meeting positioned this as a differentiating long-term vision.

**Suggested Approach:**
Long-term feature (not MVP). Possible implementation:
1. Network/Sending Church directory where organizations opt in to be discoverable.
2. Planter can browse the directory, view network descriptions/focus areas, and request to connect.
3. Connection request goes through the existing invitation system (flipped direction: planter requests, organization accepts).
4. Would require new FRD when prioritized.

---

### 17. Marketing / Pitch Deck

**Priority:** Operational (not a product feature)

**Meeting Discussion:**
A pitch deck or summary document is planned to help introduce the app to prospective users and stakeholders. Brett indicated the need for marketing materials that clearly convey the app's value and purpose to planters.

**Documentation/Implementation Status:**
Not applicable -- this is an operational/marketing need, not a product feature.

**Suggested Approach:**
Create a pitch deck covering:
1. Problem statement (disconnected tools, no unified system)
2. Product vision (learn, plan, execute, measure)
3. Key features walkthrough (wiki, CRM, meetings, teams, communication)
4. Sending church value proposition (portfolio visibility, reduced update chasing)
5. Demo screenshots from the current app
6. Roadmap (upcoming: tasks, documents, financial tracking)
7. How to get started / beta access

---

## Decisions to Record in Product Documentation

The following decisions or insights from the meeting should be formally recorded in the relevant product documents.

| Decision / Insight | Where to Record | Status |
|-------------------|-----------------|--------|
| Manual status changes backward/skip should require reasons | F2 FRD - add requirement | New requirement |
| Pipeline cards should show inactivity visual indicators | F2 FRD - add requirement | New requirement |
| Phase gating should be soft (advisory, not blocking) with manual override | System Architecture - Phase Engine section | Clarification of existing spec |
| Non-linear phase progression must be supported | System Architecture - Phase Engine section | Clarification |
| Top-down data visibility (sending church controls) is deferred; bottom-up (planter controls) ships first | Product Brief - Resolved Decisions | New resolved decision |
| Sending church account ownership/provisioning is deferred to billing system design | Product Brief - Open Questions or Resolved Decisions | New deferred decision |
| Data export (CSV) should be elevated from Nice to Have to Should Have for People | F2 FRD - P-027 priority change | Priority elevation |
| Planning Center integration elevated from Nice to Have to post-MVP priority | F2 FRD - P-026 priority change | Priority elevation |
| Campus planter model (autonomous vs. campus) is an open question | Product Brief - Open Questions | New open question |
| Wiki network-level customization (add/exclude articles) validated as future need | F1 FRD - W-024 detail expansion | Scope clarification |

---

## Action Items

### Sebastian Garces

| Action | Priority | Dependency | Status |
|--------|----------|------------|--------|
| Set up separate production database | Near-term | None | Pending |
| Add in-app feedback button | Near-term | None | Not started |
| Implement Task Management (F5) -- core CRUD first | Near-term | None | Not started |
| Build Phase Engine service with soft gating | Near-term | Partial F5 (for task-based criteria) | Not started |
| Implement Document Templates (F6) -- template library first | Near-term | None | Not started |
| Add pipeline inactivity indicators and manual status change reasons | Near-term | None | Not started |
| Expand Progress Dashboard (F4) with phase progress and Core Group metrics | Medium-term | Phase Engine | Not started |
| Expand Oversight Dashboard with sending church portfolio metrics | Medium-term | F4 expansion | Not started |
| Add CSV export for People (F2) | Medium-term | None | Not started |
| Define exit criteria and task lists per phase, share for validation | Near-term | None | Pending |
| Develop pitch deck for sending churches and planters | Medium-term | None | Not started |
| Share app progress and updates for testing and feedback | Ongoing | None | Ongoing |

### Brett Stiles

| Action | Priority | Dependency | Status |
|--------|----------|------------|--------|
| Validate phase exit criteria documents and task assignments | Near-term | Sebastian shares criteria | Waiting |
| Introduce current planters to app for hands-on testing | Medium-term | Feedback button, production DB | Waiting |
| Continue Planning Center API exploration | Ongoing | None | In progress |
| Explore Cursor and LLM harness tools for AI context management | Ongoing | None | Pending |

### Bryan Nass

| Action | Priority | Dependency | Status |
|--------|----------|------------|--------|
| Validate phase exit criteria | Near-term | Sebastian shares criteria | Waiting |
| Connect Sebastian with Kirk Van Manen and Noah Oldham | Medium-term | None | Pending |

---

## Implementation Priority Roadmap

Based on the meeting discussion, documentation gaps, and implementation status, the recommended build order is:

```
Near-Term (Pre-Beta)
├── In-app feedback mechanism
├── Pipeline enhancements (inactivity indicators, status change reasons)
├── Task Management F5 (core CRUD + follow-up task generation)
├── Phase Engine (soft gating, readiness indicators)
└── Document Templates F6 (read-only template library)

Medium-Term (Beta Period)
├── Progress Dashboard F4 (phase progress, Core Group metrics, 8 CSFs)
├── Sending Church Dashboard (oversight expansion)
├── Data Export (CSV for People)
└── Wiki network customization

Post-MVP
├── Financial Tracking F7
├── Planning Center integration
├── Facility Management F10
├── Sending church account provisioning
├── Top-down data visibility model
└── Campus planter model

Long-Term Vision
├── Matchmaking / discovery features
├── SMS integration
└── Advanced ChMS integrations
```
