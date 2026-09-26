# EveryField - Product Requirements Document Index

**Updated:** September 26, 2026

---

## Document Overview

This document serves as an index to the EveryField requirements documentation system. Requirements are organized following a **context-sharded** approach optimized for AI-assisted development.

For documentation rules and structure, see [Requirements Documentation Rules](../.claude/skills/requirements-docs/SKILL.md).

---

## Document Structure

```
product-docs/
├── product-brief.md              # Vision, users, concepts, metrics
├── product-values.md             # How tradeoffs are decided (V1-V7) + what an FRD may contain
├── decisions.md                  # Current decisions, rationale and provenance
├── system-architecture.md        # Data model, integrations, cross-cutting services
├── core-data-contracts.md        # Shared entity contracts, referencing rules
├── launch-playbook.md            # Domain reference (source material)
├── app-summary.md                # Prose description of the product, for a reader new to it
├── prd.md                        # This index
└── features/                     # Each feature dir: frd.md (status lives on the board, not in a file)
    ├── phase-engine/             # PE: Phase Engine (Plant Intelligence)
    │   ├── frd.md
    │   ├── rubric-v0.md          # Historical evaluation rubric
    │   ├── rubric-v1.md          # Active evaluation rubric
    │   └── data-posture.md       # LLM data-sharing posture
    ├── wiki/                     # F1: Wiki / Knowledge Base
    ├── people-crm/               # F2: People / CRM Management
    ├── meetings/                 # F3: Meetings
    ├── progress-dashboard/       # F4: ARCHIVAL - retired into the Phase Engine
    ├── task-project-management/  # F5: Task & Project Management
    ├── document-templates/       # F6: Document Templates & Generation
    ├── financial-tracking/       # F7: Financial Tracking
    ├── ministry-team-management/ # F8: Ministry Team Management
    ├── communication-hub/        # F9: Communication Hub
    ├── facility-management/      # F10: ARCHIVAL - cut
    ├── notifications/            # F11: Notifications & Digest (shared delivery infrastructure)
    ├── planter-onboarding/       # F12: Planter Onboarding
    ├── accounts-and-seats/       # AS: Account authority and tenancy
    ├── oversight/                # OV: Oversight (Sending Church & Network)
    ├── launch/                   # LS: Launch (Launch Sunday)
    └── church-plant-agent/
        └── frd.md                # EV: ARCHIVAL, retired agent specification
```

Historical meeting notes, alpha rationale, dated research and wiki content guidance remain as source material. Completed sprint plans, superseded audits and the old delivery-system design are available in Git history; current status and dependencies live on the GitHub board.

**Implementation status is not in any of these files.** The GitHub board is the only source of what is built, in flight, or queued (`gh issue list --label feature`).

---

## Core Documents

### [Product Brief](./product-brief.md)

Defines *why* the product exists and *what success means*.

**Contains:**
- Problem statement
- Product vision
- Target users
- Core concepts & domain language (4 C's, 8 Critical Success Factors, Ministry Funnel, etc.)
- Phase structure (high-level)
- Success metrics
- Non-goals
- Open questions (product-level)

### [Product Values](./product-values.md)

Defines *how tradeoffs are decided* when two options both look reasonable.

**Contains:**
- The seven values (V1–V7), each with a falsifiable test
- What this means for FRDs — an FRD states the end state; status and ruling history stay out

### [Decision Ledger](./decisions.md)

The single home for dated product and canon decisions.

**Contains:**
- Every ruling, once, as a dated row keyed by its issue/PR number, with its consequence
- The rules for how a ruling reaches an FRD, the Product Brief, and `memory/invariants.md`

**Note:** a ruling is recorded here and nowhere else. FRDs absorb a ruling by becoming correct; they do not carry dates, issue numbers, or supersession chains.

### [System Architecture](./system-architecture.md)

Defines system-wide constraints and technical foundations.

**Contains:**
- High-level architecture
- Data ownership boundaries
- Cross-cutting services (Phase Engine, Auth, Search)
- Third-party integration points
- Non-functional requirements

### [Core Data Contracts](./core-data-contracts.md)

Defines shared entity contracts and cross-feature rules.

**Contains:**
- Shared entities (Church, User, Person, Phase) with contract-level fields
- Referencing rules (features store IDs, not duplicated fields)
- Cross-feature invariants (tenant scoping, audit expectations, event naming)

### [Launch Playbook](./launch-playbook.md)

Domain reference document - the authoritative source material the product implements.

**Note:** This is reference material, not a requirements document. Requirements *reference* this document, not duplicate it.

---

## Feature Requirements Documents (FRDs)

Each feature has its own FRD defining *what that feature must do*. FRDs are independently understandable and may only reference the Product Brief and System Architecture. An FRD describes the end state, never the build state — see [Product Values](./product-values.md) §What this means for FRDs.

| Code | Feature | FRD Location |
|------|---------|--------------|
| PE | [Phase Engine (Plant Intelligence)](./features/phase-engine/frd.md) | **Primary differentiator.** Advisory LLM-as-judge engine: reads each plant's activity, judges it against the methodology (RAG), surfaces prioritized insights to planters and health signals to overseers |
| F1 | [Wiki / Knowledge Base](./features/wiki/frd.md) | Educational resource with structured guidance |
| F2 | [People / CRM Management](./features/people-crm/frd.md) | Contact and relationship tracking |
| F3 | [Meetings](./features/meetings/frd.md) | Plan, execute, and track all meeting types (Vision Meetings, Orientations, Team Meetings) |
| F5 | [Task & Project Management](./features/task-project-management/frd.md) | Tasks, checklists, timeline |
| F6 | [Document Templates & Generation](./features/document-templates/frd.md) | Template library and document generation |
| F7 | [Financial Tracking](./features/financial-tracking/frd.md) | Budget and giving metrics |
| F8 | [Ministry Team Management](./features/ministry-team-management/frd.md) | Team organization and health |
| F9 | [Communication Hub](./features/communication-hub/frd.md) | Messaging and communication |
| F11 | [Notifications & Digest](./features/notifications/frd.md) | Shared delivery infrastructure — in-app rail, email digest, preferences. Other features stop inventing their own delivery |
| F12 | [Planter Onboarding](./features/planter-onboarding/frd.md) | First-run journey from account creation to a usable plant |
| OV | [Oversight (Sending Church & Network)](./features/oversight/frd.md) | The overseer's surface: plant directory and detail, privacy-gated aggregates, association invite/accept/sever with audit |
| LS | [Launch (Launch Sunday)](./features/launch/frd.md) | Launch as a first-class entity — target date, status lifecycle, readiness milestones, and the day's outcome |

### Archival FRDs (not live features)

These documents are kept as a record of the design. Do not build from them, and do not report their requirements as gaps.

| Code | Feature | Why it is archival |
|------|---------|--------------------|
| F4 | [Progress Dashboard](./features/progress-dashboard/frd.md) | Retired into the Phase Engine. Its surviving presentation requirements moved across as Phase Engine display requirements ([`decisions.md`](./decisions.md), decision #4) |
| EV | [Evry](./features/church-plant-agent/frd.md) | Excluded from alpha; retained for immutable migration requirement references. A future agent needs a new specification. |
| F10 | [Facility Management](./features/facility-management/frd.md) | Cut — off the roadmap, not deferred ([`decisions.md`](./decisions.md), decision #3) |

---

## How to Use This Documentation

### For Product Understanding
Start with the [Product Brief](./product-brief.md) to understand the vision, users, and domain concepts.

### For Technical Context
Review [System Architecture](./system-architecture.md) for data models, integrations, and system-wide constraints.

### For Feature Development
Read the specific feature's FRD. Each FRD is self-contained with:
- Overview and purpose
- Screen wireframes
- Workflows
- Data model
- Integration points
- Success metrics
- Open questions

### For Domain Knowledge
Reference the [Launch Playbook](./launch-playbook.md) for the underlying church planting methodology.

### For "why is it this way?"
Look the ruling up in the [Decision Ledger](./decisions.md). It is keyed by issue number and carries the consequence of each decision.

### For Implementation Status
Read the GitHub board — `gh issue list --label feature`. No document in `product-docs/` reports what is built.

---

## Document Principles

1. **Documents are context boundaries, not convenience bundles** - Each document serves a specific purpose and audience.

2. **No duplication** - Content lives in one place only. Reference, don't repeat.

3. **Independent FRDs** - Each feature FRD can be understood without reading other FRDs.

4. **Implementation-agnostic** - Requirements describe *what*, not *how*.

5. **AI-optimized** - Documents are sized and structured for effective LLM context loading.

6. **An FRD states the end state, not the history** - A requirement may carry one line of *why*. It never carries ruling dates, issue numbers, supersession chains, or "previously/currently/not yet" narration. Decisions live in [`decisions.md`](./decisions.md); status lives on the board. See [Product Values](./product-values.md) §What this means for FRDs.

---
