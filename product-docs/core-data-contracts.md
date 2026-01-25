# EveryField - Core Data Contracts

**Version:** 1.0  
**Date:** January 25, 2026

---

## Purpose

This document defines shared entity contracts and cross-feature rules. It specifies **what features can depend on** without duplicating full schemas. Feature-owned models and detailed implementations live in each feature's FRD.

---

## Shared Entities

### Church

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key; referenced by all feature data |
| `current_phase` | Enum (0-6) | Drives phase-aware UI/logic across features |

### User

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key |
| `church_id` | UUID (FK) | Nullable for coaches/network admins |
| `role` | Enum | `planter` / `coach` / `team_member` / `network_admin` |

### Person

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key |
| `church_id` | UUID (FK) | Required; scoping key |
| `first_name` | String | Display name (required) |
| `last_name` | String | Display name (required) |
| `status` | Enum | Pipeline position (values defined in F2 FRD) |

### Phase

| Field | Type | Contract |
|-------|------|----------|
| `id` | Enum (0-6) | Phase identifier |
| `exit_criteria` | JSON | Conditions for progression (Phase Engine evaluates) |

---

## Referencing Rules

Features **reference shared entities by ID only**—never duplicate profile fields.

| Pattern | Example | Rationale |
|---------|---------|-----------|
| Store `person_id` | Task.assigned_to → Person.id | Single source of truth for name/contact |
| Store `user_id` | Note.created_by → User.id | Audit and ownership |
| Store `church_id` | All feature tables | Tenant scoping |
| Read `current_phase` | Filter wiki content by phase | Phase-aware behavior |

**Anti-patterns (avoid):**
- Storing `person_name` alongside `person_id`
- Caching `church_name` in feature tables
- Duplicating `user.role` in feature-specific permission columns

---

## Cross-Feature Invariants

### Tenant Scoping

> **All feature data MUST include `church_id` and enforce row-level isolation.**

- Every feature table includes `church_id` foreign key
- Row-level security enforced at database layer
- Coach/Network Admin roles may have cross-church read access for assigned churches only
- No cross-tenant data leakage in queries, exports, or search results

### Audit Expectations

| Requirement | Scope |
|-------------|-------|
| `created_at`, `updated_at` | All mutable entities |
| `created_by` (user_id) | User-initiated mutations |
| Immutable audit trail | Financial data (F7) |
| Criteria snapshot on transition | Phase changes |

### Event Naming Conventions

Events follow `entity.action` pattern:

| Event | Emitter | Subscribers |
|-------|---------|-------------|
| `phase.changed` | Phase Engine | All phase-aware features |
| `phase.criteria.updated` | Phase Engine | Dashboard (F4) |
| `person.created` | F2 (People/CRM) | Features needing person sync |
| `person.status.changed` | F2 (People/CRM) | Dashboard, Communication |

**Event contract:**
- Events include `church_id` for scoping
- Events include `timestamp` and `triggered_by` (user_id or system)
- Subscribers handle events idempotently

---

## Data Ownership Summary

| Owner | Entities | Dependents May |
|-------|----------|----------------|
| **Core** | Church, User, Phase | Read all fields |
| **F2 (People/CRM)** | Person | Read; write attendance/assignment via own tables |

Features own their domain tables and reference shared entities by ID. See [System Architecture](./system-architecture.md) for full ownership map.

---

## Stability

This document defines **stable contracts**. Changes require cross-feature impact assessment. Field additions to shared entities are non-breaking; field removals or type changes require migration coordination.
