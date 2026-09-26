# EveryField - System Architecture

**Updated:** September 26, 2026

---

## Overview

This document defines system-wide constraints, data ownership boundaries, and cross-cutting contracts for the EveryField platform. Feature-specific schemas and behaviors live in each feature's FRD.

---

## High-Level Architecture

EveryField uses feature-owned data and behavior with shared authentication, tenant scoping, Plant Intelligence, search and file storage. The [requirements index](prd.md) names the live features and separately identifies retired specifications.

## Core Canonical Models

These are the **only** shared entities that features may depend on: **SendingNetwork**, **SendingChurch**, **Church**, **User**, **Person**, **Phase**. All other models are feature-owned.

**Key invariant:** Every record has an explicit owner: plant, organization, account or global content. Reads and writes enforce that scope; global content is an explicit exception, not a missing authorization check.

For detailed contracts, referencing rules, and cross-feature invariants, see **[Core Data Contracts](./core-data-contracts.md)**.

---

## Data Ownership

Feature-owned entities and behavior belong to their FRDs; concrete table definitions belong to `src/db/schema/`. Shared entity meanings and association boundaries are defined in [Core Data Contracts](core-data-contracts.md). Cross-feature use goes through the owning domain's contracts rather than duplicating schema tables in this document.

## Cross-Cutting Services

### Phase Engine (Plant Intelligence)

The platform's primary differentiator. An **advisory intelligence engine**, not a gating state machine: it continuously reads each plant's real activity, judges it against the church-planting methodology (Launch Playbook + wiki) via an LLM-as-judge grounded in retrieved content (RAG), and surfaces prioritized **insights** to planters and **health signals** to sending networks/churches. The phase is *context for judgment*, not a gate — advancement is soft-gated and always planter-confirmed. Detailed behavior, entities, and the evaluation rubric live in the **[Phase Engine FRD](./features/phase-engine/frd.md)**.

**Architectural principle — facts vs. judgment (mandatory):** all countable facts are computed deterministically from the database (the *Signal layer*); the LLM (the *Judgment layer*) interprets and prioritizes but never produces a number. Assessments are precomputed snapshots read instantly by the UI; the judge runs asynchronously, debounced to plants with material activity.

**Responsibilities:**
- Track `current_phase` per church and record planter-initiated transitions (forward/back/skip, never blocked)
- Compute the deterministic plant fact snapshot (Signal layer)
- Produce LLM-as-judge assessments against a versioned rubric, grounded in methodology RAG
- Emit `phase.changed` (on transition) and `plant.assessment.created` (on new snapshot)
- Maintain an immutable transition + assessment audit history

Readiness criteria and rubric versions belong to the Phase Engine specification. They advise the planter and never block an explicit phase transition.

---

### Authentication & Authorization

#### Hierarchical Tenant Model

A plant can associate independently with a sending church and a network; neither relationship is inherited from the other. A sending church can also associate with a network. All of those associations are optional and mutable.

Accounts hold seats in a plant or oversight organization. Coaches reach plants through separate assignments, and discovery profiles can exist before a plant or seat does.

A sending church may be:
- Independent (no network affiliation)
- Part of a sending network

#### Association & Invitation System

Associations between entities are managed through an invitation system:
- **Oversight invites, target accepts.** The sending church or network Owner initiates the invitation. The target's authorized Owner or discovery account accepts or declines.
- Associations can be created at any time (**late association**) and removed (**disassociation**), with full audit logging.
- Coach assignment is initiated by an authorized plant Owner or Admin.
- On acceptance, the target entity's FK is updated (e.g., `churches.sending_church_id` is set). On removal, the FK is set back to null.

#### Seats and Scope

A capability combines seat and tenancy; coaching adds assignment-based read scope. Org Members have the Owner's read scope but no administrative writes. Plant Members retain their explicitly scoped own-duty operations. Discovery is an explicit pre-plant profile and grants no tenant reach.

Tenant isolation is application-enforced. Oversight receives privacy-gated aggregates, never individual CRM records; basic portfolio facts and named consent-exempt milestones have separate rules. A coach's consent is the assignment, not the oversight toggles.

---

### Search Service

Unified full-text search across: Wiki articles, People (name/email/phone), Tasks, Documents.

### File Storage

Document uploads, template storage and exports are scoped to their owning plant or account. Private objects are served through an authenticated application boundary; a storage key is not a public URL.

---

## Integration Boundaries

### Integration Direction

The feature specifications govern which integrations are in scope; this table does not claim that every integration is implemented.

| Function | Purpose | Integration |
|----------|---------|-------------|
| Email | Bulk/transactional delivery | Resend API |
| SMS | Text messaging | API (Twilio) |
| Payment | Online giving | Redirect + Webhook |
| ChMS | Member sync | API (Planning Center, Breeze) |
| Calendar | Scheduling | OAuth + API |
| Video | Wiki content | Embed (YouTube, Vimeo) |

### Integration Principles

1. **EveryField owns the workflow** — external services handle execution
2. **Data lives in EveryField** — integrations are endpoints, not stores
3. **Graceful degradation** — features work without integrations (manual fallback)
4. **User-configurable** — planters enable/disable per church

---

## Non-Functional Requirements

### Multi-Tenancy

**Hierarchical Scoping:**
- Plant feature data is church-scoped; org and account data retain their own scope
- Churches optionally belong to `sending_church_id` and/or `sending_network_id` (both nullable)
- Tenant isolation enforced at application layer; DB-layer RLS is a future goal

**Access Patterns:**
- Planters/Team Members: Single church scope (`user.church_id`)
- Coaches: Multiple assigned churches (via `coach_assignments` table)
- Sending-church seats: The organization's associated plants; seat controls writes, not portfolio read parity
- Network seats: Plants directly associated with the network through their own `sending_network_id`; a sending church's network association grants no additional plant reach

**Late Association & Disassociation:**
- Church plants can operate indefinitely without any sending relationship
- Sending churches can operate indefinitely without a network
- Associations are created via the invitation system and can be changed at any time
- Association changes update the relevant FK and are audit-logged

**Per-Feature Privacy Controls:**
- Each church plant has a `church_privacy_settings` record controlling which features are visible to oversight users
- Privacy toggles: `share_people`, `share_meetings`, `share_tasks`, `share_financials`, `share_ministry_teams`, `share_facilities`
- Self-started plants default closed; first-association acceptance can establish invite-origin defaults with explicit consent, without resetting an already-associated plant's choices
- Oversight users only see aggregate data for features the planter has enabled

### Security

- Row-level isolation on all church data (application layer; DB-layer RLS is a future goal)
- Encryption at rest; HTTPS in transit
- Regular security audits

### Performance

- Dashboard < 2s load
- Search < 500ms
- Real-time updates for collaborative features

### Audit

- All mutations logged with `user_id` and timestamp
- Immutable audit trail for financial data
- Phase transitions logged with criteria snapshot

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Framework** | Next.js 16 (App Router) | Full-stack React with RSC, API routes, middleware |
| **Language** | TypeScript | End-to-end type safety |
| **UI Components** | shadcn/ui | Accessible, customizable, owned components |
| **Styling** | Tailwind CSS v4+ | Utility-first, pairs with shadcn |
| **Database** | PostgreSQL | Relational, RLS support, complex queries |
| **ORM** | Drizzle | Type-safe, lightweight, native RLS support |
| **Validation** | Zod | Runtime type validation, schema-first, TypeScript integration |
| **Authentication** | Custom (session-based) | No third-party dependency; follows Lucia/Copenhagen patterns |
| **Authorization** | Seat and tenancy capabilities | Shared authority rules with subject-specific own-duty checks |
| **Multi-tenancy** | Application-layer `church_id` scoping | Enforced in query helpers; PostgreSQL RLS is a future goal |
| **Package Manager** | pnpm | Fast, disk-efficient, strict dependency management |

### Tech Stack Constraints

| Layer | Constraint |
|-------|------------|
| Frontend | Responsive; future offline support |
| Backend | Multi-tenant; real-time capable |
| Database | Relational; complex queries; application-enforced tenant isolation |
| File Storage | Document storage with church scoping |
| Search | Full-text across wiki, people, tasks |

---

### Authentication Approach

Session-based authentication following [Lucia](https://lucia-auth.com/) and [The Copenhagen Book](https://thecopenhagenbook.com/) guidelines:

- Database-stored sessions (not JWTs) for immediate revocability
- Secure httpOnly cookies with proper SameSite settings
- Password hashing with Argon2id
- CSRF protection on state-changing requests
- Rate limiting on authentication endpoints

### Authorization Enforcement

Every mutation boundary establishes the authenticated actor and checks the required capability before trusting input. Subject-specific authority is checked against stored, tenant-scoped records. Route handlers require their own guards; a page gate or proxy redirect is not authorization for a write. Privacy is checked before returning oversight data, and conflicting tenancy claims fail closed.
