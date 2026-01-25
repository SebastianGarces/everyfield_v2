# EveryField - System Architecture

**Version:** 1.2  
**Date:** January 25, 2026

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

These are the **only** shared entities that features may depend on: **Church**, **User**, **Person**, **Phase**. All other models are feature-owned.

**Key invariant:** All feature data MUST include `church_id` and enforce row-level isolation.

For detailed contracts, referencing rules, and cross-feature invariants, see **[Core Data Contracts](./core-data-contracts.md)**.

---

## Data Ownership Map

> **Principle:** Feature-owned models live in the owning FRD. This table shows boundaries only.

| Feature | Owned Entities | References |
|---------|---------------|------------|
| **Core** | Church, User, Phase | — |
| **F1: Wiki** | WikiArticle, WikiSection, WikiProgress, WikiBookmark, WikiTemplate, WikiVideo | User, Phase |
| **F2: People/CRM** | Person, Assessment, Interview, Commitment | Church, User |
| **F3: Vision Meeting** | VisionMeeting, VisionMeetingAttendance, Invitation | Person |
| **F4: Dashboard** | *(aggregates only)* | All |
| **F5: Task Management** | Task, Checklist, Milestone | Person, User |
| **F6: Documents** | Document, Template | Church, Person |
| **F7: Financial** | Budget, BudgetLineItem | Church |
| **F8: Ministry Teams** | MinistryTeam, TeamRole, TeamMembership, TeamMeeting, TeamMeetingAttendance | Person |
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

| User Type | Scope |
|-----------|-------|
| Planter | Own church data |
| Coach | Read access to assigned planters' churches |
| Team Member | Feature-limited access within own church |
| Network Admin | Network-wide read + analytics |

**Invariants:**
- Church-scoped data isolation via row-level security
- Role determines feature access; church_id determines data access

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

- All data scoped to `church_id` (architectural invariant)
- Row-level security enforced at database layer
- Coach cross-church access limited to assigned planters

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
| `coach` | Assigned churches | Read access to assigned planters' data |
| `team_member` | Own church | Feature-limited access within church |
| `network_admin` | Network-wide | Read + analytics across network |

**Enforcement:**
- PostgreSQL RLS policies enforce `church_id` isolation at database layer
- Application sets `app.current_church_id` session variable per request
- Middleware validates role permissions before route access
