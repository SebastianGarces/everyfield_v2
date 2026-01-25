# EveryField - Product Requirements Document Index

**Version:** 2.0  
**Date:** January 25, 2026

---

## Document Overview

This document serves as an index to the EveryField requirements documentation system. Requirements are organized following a **context-sharded** approach optimized for AI-assisted development.

For documentation rules and structure, see [Requirements Documentation Rules](../.cursor/requirements-docs.md).

---

## Document Structure

```
product-docs/
├── product-brief.md              # Vision, users, concepts, metrics
├── system-architecture.md        # Data model, integrations, cross-cutting services
├── core-data-contracts.md        # Shared entity contracts, referencing rules
├── launch-playbook.md            # Domain reference (source material)
├── prd.md                        # This index
└── features/
    ├── wiki/
    │   └── frd.md                # F1: Wiki / Knowledge Base
    ├── people-crm/
    │   └── frd.md                # F2: People / CRM Management
    ├── vision-meeting-management/
    │   └── frd.md                # F3: Vision Meeting Management
    ├── progress-dashboard/
    │   └── frd.md                # F4: Progress Dashboard
    ├── task-project-management/
    │   └── frd.md                # F5: Task & Project Management
    ├── document-templates/
    │   └── frd.md                # F6: Document Templates & Generation
    ├── financial-tracking/
    │   └── frd.md                # F7: Financial Tracking
    ├── ministry-team-management/
    │   └── frd.md                # F8: Ministry Team Management
    ├── communication-hub/
    │   └── frd.md                # F9: Communication Hub
    └── facility-management/
        └── frd.md                # F10: Facility Management
```

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

Each feature has its own FRD defining *what that feature must do*. FRDs are independently understandable and may only reference the Product Brief and System Architecture.

| Code | Feature | FRD Location |
|------|---------|--------------|
| F1 | [Wiki / Knowledge Base](./features/wiki/frd.md) | Educational resource with structured guidance |
| F2 | [People / CRM Management](./features/people-crm/frd.md) | Contact and relationship tracking |
| F3 | [Vision Meeting Management](./features/vision-meeting-management/frd.md) | Meeting planning, execution, follow-up |
| F4 | [Progress Dashboard](./features/progress-dashboard/frd.md) | Visual progress and health indicators |
| F5 | [Task & Project Management](./features/task-project-management/frd.md) | Tasks, checklists, timeline |
| F6 | [Document Templates & Generation](./features/document-templates/frd.md) | Template library and document generation |
| F7 | [Financial Tracking](./features/financial-tracking/frd.md) | Budget and giving metrics |
| F8 | [Ministry Team Management](./features/ministry-team-management/frd.md) | Team organization and health |
| F9 | [Communication Hub](./features/communication-hub/frd.md) | Messaging and communication |
| F10 | [Facility Management](./features/facility-management/frd.md) | Venue search and management |

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

---

## Document Principles

1. **Documents are context boundaries, not convenience bundles** - Each document serves a specific purpose and audience.

2. **No duplication** - Content lives in one place only. Reference, don't repeat.

3. **Independent FRDs** - Each feature FRD can be understood without reading other FRDs.

4. **Implementation-agnostic** - Requirements describe *what*, not *how*.

5. **AI-optimized** - Documents are sized and structured for effective LLM context loading.

---

## Changelog

### v2.0 (January 25, 2026)
- Refactored to context-sharded structure
- Created Product Brief separating vision from implementation
- Created System Architecture for cross-cutting concerns
- Separated all features into individual FRDs
- This document converted to lightweight index

### v1.1 (January 24, 2026)
- Added F1 Wiki FRD
- Added F8 Ministry Team Management FRD

### v1.0 (January 24, 2026)
- Initial monolithic PRD
