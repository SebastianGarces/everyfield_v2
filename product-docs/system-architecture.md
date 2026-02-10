# EveryField - System Architecture

**Version:** 1.3  
**Date:** February 7, 2026

---

## Overview

This document defines system-wide constraints, data ownership boundaries, and cross-cutting contracts for the EveryField platform. Feature-specific schemas and behaviors live in each feature's FRD.

---

## High-Level Architecture

EveryField follows a feature-based modular architecture where each feature (F1-F10) owns its specific data and behavior while sharing common entities and services.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           EveryField Platform                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Feature Layer                                │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│   │
│  │  │ F1  │ │ F2  │ │ F3  │ │ F4  │ │ F5  │ │ F6  │ │ F7  │ │ F8  ││   │
│  │  │Wiki │ │CRM  │ │VM   │ │Dash │ │Task │ │Docs │ │Fin  │ │Team ││   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘│   │
│  │  ┌─────┐ ┌─────┐                                                │   │
│  │  │ F9  │ │ F10 │                                                │   │
│  │  │Comm │ │Fac  │                                                │   │
│  │  └─────┘ └─────┘                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Cross-Cutting Services                        │   │
│  │    Phase Engine │ Auth │ Search │ File Storage                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   External Integrations                         │   │
│  │  Email │ SMS │ Payment │ Calendar │ Video │ ChMS               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Canonical Models

These are the **only** shared entities that features may depend on: **SendingNetwork**, **SendingChurch**, **Church**, **User**, **Person**, **Phase**. All other models are feature-owned.

**Key invariant:** All feature data MUST include `church_id` and enforce row-level isolation. Exception: platform-wide content (e.g., global Wiki articles) uses nullable `church_id` where `null` = visible to all.

For detailed contracts, referencing rules, and cross-feature invariants, see **[Core Data Contracts](./core-data-contracts.md)**.

---

## Data Ownership Map

> **Principle:** Feature-owned models live in the owning FRD. This table shows boundaries only.

| Feature | Owned Entities | References |
|---------|---------------|------------|
| **Core** | SendingNetwork, SendingChurch, Church, User, Phase, CoachAssignment, OrganizationInvitation, ChurchPrivacySettings | — |
| **F1: Wiki** | WikiArticle, WikiSection, WikiProgress, WikiBookmark, WikiTemplate, WikiVideo | User, Phase |
| **F2: People/CRM** | Person, Assessment, Interview, Commitment | Church, User |
| **F3: Vision Meeting** | VisionMeeting, VisionMeetingAttendance, Invitation, Location, MeetingEvaluation, MeetingChecklistItem | Person |
| **F4: Dashboard** | *(aggregates only)* | All |
| **F5: Task Management** | Task, Checklist, Milestone | Person, User |
| **F6: Documents** | Document, Template | Church, Person |
| **F7: Financial** | Budget, BudgetLineItem | Church |
| **F8: Ministry Teams** | MinistryTeam, TeamRole, TeamMembership, TeamMeeting, TeamMeetingAttendance, TrainingProgram, TrainingCompletion | Person |
| **F9: Communication** | Communication, Note | Person, User |
| **F10: Facility** | Facility, SiteVisit | Task, Document |

---

## Cross-Cutting Services

### Phase Engine

Manages church progression through the 6-phase journey.

**Responsibilities:**
- Track `current_phase` per church
- Validate phase transition criteria
- Emit `phase.changed` and `phase.criteria.updated` events
- Maintain phase history audit log

**Exit Criteria Summary:**

| Transition | Key Gates |
|------------|-----------|
| 0 → 1 | Foundational modules complete, values documented, coach assigned |
| 1 → 2 | 30-40 committed adults, financial base, worship leader, geographic area |
| 2 → 3 | All 8 team leaders assigned, launch date set |
| 3 → 4 | Team training complete, systems tested, 3-4 weeks to launch |
| 4 → 5 | Pre-launch services done, promotion executed |
| 5 → 6 | First service complete, guest data entered, debrief done |

---

### Authentication & Authorization

#### Hierarchical Tenant Model

```
SendingNetwork (optional, standalone)
    └── SendingChurch(es) (optional, can exist independently)
        └── Church Plant(s) (can exist independently)
            └── Users (planter, coach, team members)
```

**Design principle: All relationships are optional and mutable.** Every entity can exist independently and be associated later via the invitation system. All hierarchy FKs (`sending_church_id`, `sending_network_id`) are nullable.

A church plant may be:
- Independent (no sending relationship)
- Sent by a church only (sending church has no network)
- Sent by a church within a network
- Directly under a network (no sending church)

A sending church may be:
- Independent (no network affiliation)
- Part of a sending network

#### Association & Invitation System

Associations between entities are managed through an invitation system:
- **Oversight invites, target accepts.** The sending church admin or network admin initiates the invitation. The planter (or sending church admin) must accept or decline.
- Associations can be created at any time (**late association**) and removed (**disassociation**), with full audit logging.
- Coach assignment is **planter-initiated**: the planter invites their coach.
- On acceptance, the target entity's FK is updated (e.g., `churches.sending_church_id` is set). On removal, the FK is set back to null.

#### User Roles and Scope

| User Type | Scope | Access |
|-----------|-------|--------|
| Planter | Own church | Full CRUD on church data |
| Coach | Assigned churches | Read access to assigned planters' data (via `coach_assignments`) |
| Team Member | Own church | Feature-limited access |
| Sending Church Admin | Sent churches | Aggregate metrics only (per planter's privacy settings) |
| Network Admin | Network churches | Network-wide aggregate metrics only (per planter's privacy settings) |

**Invariants:**
- Church-scoped data isolation enforced at application layer (DB-layer RLS is a future goal)
- Role determines feature access; church_id determines data access
- Oversight users (sending church/network) see aggregate metrics only; no individual person records
- Planters control what data is visible to oversight via **per-feature privacy toggles**

---

### Search Service

Unified full-text search across: Wiki articles, People (name/email/phone), Tasks, Documents.

### File Storage

Document uploads, template storage, export generation (PDF, XLSX). All files scoped to `church_id`.

---

## Integration Boundaries

### External Services

| Function | Purpose | Integration |
|----------|---------|-------------|
| Email | Bulk/transactional delivery | API (SendGrid, SES) |
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
- All feature data scoped to `church_id` (architectural invariant)
- Churches optionally belong to `sending_church_id` and/or `sending_network_id` (both nullable)
- Tenant isolation enforced at application layer; DB-layer RLS is a future goal

**Access Patterns:**
- Planters/Team Members: Single church scope (`user.church_id`)
- Coaches: Multiple assigned churches (via `coach_assignments` table)
- Sending Church Admins: All churches with matching `sending_church_id` (via `user.sending_church_id`)
- Network Admins: All churches with matching `sending_network_id` (via `user.sending_network_id`)

**Late Association & Disassociation:**
- Church plants can operate indefinitely without any sending relationship
- Sending churches can operate indefinitely without a network
- Associations are created via the invitation system and can be changed at any time
- Association changes update the relevant FK and are audit-logged

**Per-Feature Privacy Controls:**
- Each church plant has a `church_privacy_settings` record controlling which features are visible to oversight users
- Privacy toggles: `share_people`, `share_meetings`, `share_tasks`, `share_financials`, `share_ministry_teams`, `share_facilities`
- All default to `false` (opt-in sharing)
- Oversight users only see aggregate data for features the planter has enabled

### Security

- Row-level security on all church data
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
| **Authorization** | RBAC | Role-based access control per user type |
| **Multi-tenancy** | Row-Level Security | PostgreSQL RLS policies on `church_id` |
| **Package Manager** | pnpm | Fast, disk-efficient, strict dependency management |

### Tech Stack Constraints

| Layer | Constraint |
|-------|------------|
| Frontend | Responsive; future offline support |
| Backend | Multi-tenant; real-time capable |
| Database | Relational; complex queries + row-level security |
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

### Authorization Model

Role-Based Access Control (RBAC) with tenant scoping:

| Role | Scope | Access |
|------|-------|--------|
| `planter` | Own church | Full CRUD on own church data |
| `coach` | Assigned churches (via `coach_assignments`) | Read access to assigned planters' data |
| `team_member` | Own church | Feature-limited access within church |
| `sending_church_admin` | Sent churches (via `user.sending_church_id`) | Aggregate metrics for features planter has shared |
| `network_admin` | Network churches (via `user.sending_network_id`) | Aggregate metrics for features planter has shared |

**Enforcement:**
- Application-layer enforcement of `church_id` isolation on all queries
- Middleware validates role permissions before route access
- Privacy settings checked before returning data to oversight users
- DB-layer RLS is a future goal
