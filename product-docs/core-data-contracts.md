# EveryField - Core Data Contracts

**Version:** 1.1  
**Date:** February 3, 2026

---

## Purpose

This document defines shared entity contracts and cross-feature rules. It specifies **what features can depend on** without duplicating full schemas. Feature-owned models and detailed implementations live in each feature's FRD.

---

## Shared Entities

### SendingNetwork

Church planting networks that oversee multiple sending churches and/or church plants.

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key |
| `name` | String | Network name (e.g., "Send Network", "ARC") |

### SendingChurch

Churches that send planters. May belong to a network or operate independently.

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key |
| `name` | String | Church name |
| `sending_network_id` | UUID (FK) | Optional; parent network |

### Church

The church plant being launched. The primary tenant entity.

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key; referenced by all feature data |
| `name` | String | Church plant name |
| `current_phase` | Enum (0-6) | Drives phase-aware UI/logic across features |
| `sending_church_id` | UUID (FK) | Optional; the church that sent this plant |
| `sending_network_id` | UUID (FK) | Optional; direct network relationship (if no sending church) |

**Hierarchy note:** A church plant may have:
- No sending relationship (independent)
- Only `sending_church_id` (sent by independent church)
- Both `sending_church_id` and inherited network (sent by church in network)
- Only `sending_network_id` (directly under network, no sending church)

### User

| Field | Type | Contract |
|-------|------|----------|
| `id` | UUID | Primary key |
| `church_id` | UUID (FK) | Nullable for oversight roles |
| `sending_church_id` | UUID (FK) | Nullable; for sending church admins |
| `sending_network_id` | UUID (FK) | Nullable; for network admins |
| `role` | Enum | See role enum below |

**Role Enum:** `planter` / `coach` / `team_member` / `sending_church_admin` / `network_admin`

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

**Exception for platform-wide content:** Features with shared/global content (e.g., Wiki) may use nullable `church_id` where `null` indicates platform-wide visibility. Query pattern: `WHERE church_id IS NULL OR church_id = :current_church_id`.

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
| **Core** | SendingNetwork, SendingChurch, Church, User, Phase | Read all fields |
| **F2 (People/CRM)** | Person, Household | Read; write attendance/assignment via own tables |

Features own their domain tables and reference shared entities by ID. See [System Architecture](./system-architecture.md) for full ownership map.

---

## Stability

This document defines **stable contracts**. Changes require cross-feature impact assessment. Field additions to shared entities are non-breaking; field removals or type changes require migration coordination.
