# EveryField - Feature Dependency Graph

**Version:** 1.0  
**Date:** February 6, 2026

---

## Purpose

This document maps the dependencies between all 10 EveryField features (F1–F10) to determine which can be built in parallel and which must be sequenced. It serves as the implementation ordering guide.

For the visual diagram, see [dependency-graph.mmd](./dependency-graph.mmd).

---

## Dependency Classification

Dependencies are classified as **hard** or **soft**:

- **Hard** — The dependent feature fundamentally cannot function without the dependency existing first.
- **Soft** — An integration enhancement that can be wired up after both features exist independently.

---

## Hard Dependencies

These are blocking — the dependent feature cannot operate without the dependency:

| Dependent Feature | Depends On | Reason |
|-------------------|-----------|--------|
| F3 (Vision Meeting) | F2 (People) | Meetings track attendance via Person records |
| F8 (Ministry Teams) | F2 (People) | Teams assign Person records as members |
| F9 (Communication Hub) | F2 (People) | Messaging targets Person records as recipients |
| F4 (Progress Dashboard) | F2, F3, F5, F7, F8 | Aggregates metrics from most features; needs data sources |

---

## Soft Dependencies

These cross-feature integrations enhance functionality but are not required for core feature operation. They can be wired up once both sides exist.

| Source | Target | Integration |
|--------|--------|-------------|
| F3 (Vision Meeting) | F5 (Tasks) | Auto-creates follow-up tasks for new attendees |
| F3 (Vision Meeting) | F6 (Documents) | Accesses Vision Meeting material templates |
| F10 (Facilities) | F5 (Tasks) | Creates site visit follow-up tasks |
| F8 (Ministry Teams) | F9 (Communication) | Sends team-scoped group communications |
| F9 (Communication) | F8 (Ministry Teams) | Reads team rosters for group messaging |
| F7 (Financial) | F2 (People) | Reads Person count for giving participation rate |
| F7 (Financial) | F6 (Documents) | Imports budget templates |
| F1 (Wiki) | F6 (Documents) | Wiki articles link to downloadable templates |
| F2 (People) | F3 (Vision Meeting) | Status auto-progression on meeting attendance (event) |
| F2 (People) | F8 (Ministry Teams) | Status auto-progression on team assignment (event) |

---

## Implementation Waves

### Wave 0: Core Infrastructure

Prerequisite for all features.

- Auth system (User, Session, Roles)
- Multi-tenancy (Church, SendingChurch, SendingNetwork)
- Phase Engine (Phase transitions, exit criteria)
- Database foundation (RLS policies, `church_id` scoping)

### Wave 1: Foundation Features

These features depend only on Core Infrastructure and can all be built **simultaneously**.

| Feature | Depends On | Notes |
|---------|-----------|-------|
| **F1: Wiki** | Phase Engine | Content + phase-aware filtering |
| **F2: People/CRM** | Church, User | Central entity; unblocks Wave 2 |
| **F5: Task Management** | Church, User | Core CRUD + templates; Person linking is soft |
| **F6: Document Templates** | Church, User | Template library + generation engine |
| **F7: Financial Tracking** | Church | Budget + giving tracking; Person count metric is soft |
| **F10: Facility Management** | Church | Venue search + site visits; task creation is soft |

### Wave 2: Person-Dependent Features

These features fundamentally need Person records to function. All 3 can be built **simultaneously** once F2 is ready.

| Feature | Hard Dependency | Notes |
|---------|----------------|-------|
| **F3: Vision Meeting** | F2 (Person) | Attendance tracking requires Person records |
| **F8: Ministry Teams** | F2 (Person) | Team membership requires Person records |
| **F9: Communication Hub** | F2 (Person) | Recipient selection requires Person records |

### Wave 3: Cross-Feature Integrations

Wire up soft dependencies between features that both already exist.

- **F2 <-> F3 event loop** — Meeting attendance auto-advances Person status (`prospect` → `attendee`)
- **F2 <-> F8 event loop** — Team assignment auto-advances Person status (`core_group` → `launch_team` → `leader`)
- **F3 → F5** — Auto-create follow-up tasks when new attendee is recorded
- **F10 → F5** — Auto-create tasks from site visit scheduling
- **F8 → F9** — Team-scoped group messaging
- **F1/F3/F7 → F6** — Template linking from Wiki articles, Vision Meeting materials, and budget import

### Wave 4: Aggregation Dashboard

| Feature | Dependencies | Notes |
|---------|-------------|-------|
| **F4: Progress Dashboard** | F2, F3, F5, F7, F8 | Read-only aggregation; can be built incrementally as features come online, but is most useful once F2, F3, F7, F8 exist |

---

## Sequencing Summary

```
Wave 0:  [Core Infrastructure]
              │
Wave 1:  [F1] [F2] [F5] [F6] [F7] [F10]   ← all 6 in parallel
              │
         (F2 ready)
              │
Wave 2:  [F3] [F8] [F9]                     ← all 3 in parallel
              │
Wave 3:  [Cross-feature integrations]        ← wire up events
              │
Wave 4:  [F4: Dashboard]                     ← aggregation layer
```

---

## Critical Path: F2 (People/CRM)

F2 is the single most important feature to complete because:

1. It owns the **Person** entity, which 6 out of 10 features reference
2. It directly **unblocks 3 features** (F3, F8, F9) that cannot start without it
3. It emits `person.created` and `person.status.changed` events consumed across the platform

Prioritizing F2 completion maximizes parallelism for subsequent waves.

---

## Current Status

| Feature | Status |
|---------|--------|
| Core Infrastructure (Auth, Multi-tenancy) | Implemented |
| F1: Wiki | Implemented |
| F2: People/CRM | In Progress |
| F3–F10 | Not Started |
