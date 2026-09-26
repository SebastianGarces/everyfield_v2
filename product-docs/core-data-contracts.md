# EveryField - Core Data Contracts

This document defines shared meanings and ownership boundaries. Field names, types and constraints are defined in `src/db/schema/`; feature requirements define desired behavior. Do not maintain a second schema here.

## Shared Entities

| Entity | Cross-feature meaning |
|---|---|
| SendingNetwork | An oversight organization that can associate with sending churches and plants. |
| SendingChurch | An oversight organization, distinct from a plant; it can operate independently or associate with a network. |
| Church | The plant and primary tenant for operational feature data. Its sending-church and direct-network associations are independent; one does not imply or replace the other. |
| User | A login identity. Authority is a seat plus its tenancy, not a flat role. Coaching assignments and a discovery profile are separate relationships. |
| Person | A plant's CRM identity. An optional account link identifies that person for own-duty checks but grants no seat or general authority. |
| Phase | A plant's advisory journey context. Initial declarations record attested history; transitions record a change, and the two must not be counted interchangeably. |

### Seats, coaching and discovery

Owner, Admin and Member are seats held in one tenancy: a plant, sending church or network. A null seat means no seat, not necessarily a coach. An account with conflicting tenancy claims fails closed. Original registration can precede plant creation; discovery is an explicit profile rather than an inference from absent tenancy.

Coaching grants read access through an active assignment, independently of a seat an account may hold elsewhere. A discovery association grants neither an org seat nor tenant access. Creating a plant and accepting a plant seat establish the appropriate person link; org seats and coach assignments do not create CRM people.

### Associations and privacy

Association invitations bind consenting entities; seat invitations grant account standing; coach invitations grant assignments. These are different authorities and must not be inferred from one another. Associations can be accepted or severed with the relevant subject's audit history.

Feature sharing governs oversight aggregates, never individual person records. Self-started plants default closed. Acceptance of the first oversight association can establish invite-origin sharing defaults with explicit consent; re-invitation must not overwrite choices made while already associated. The basic portfolio listing and the named consent-exempt milestones remain visible under their separate rules. Coaching reads use assignment consent, not oversight sharing toggles.

## Referencing Rules

Features reference shared identities instead of copying mutable profile fields. A task assignee references an account; a team member or meeting attendee references a person. Those identifiers are not interchangeable.

Do not mirror church names or permissions in feature tables. Display and authority resolve from the owning entity. Tenant scope must be established from the authenticated actor or an explicitly authorized relationship, never trusted from a submitted id.

## Cross-Feature Invariants

### Tenant scoping

Plant data is scoped to its church; oversight-owned data is scoped to its org; account-owned data is scoped to its account. Global content, such as shared wiki articles, has an explicit global case. Isolation is enforced by the application; database RLS is not a fallback.

The same boundaries apply to lists, by-id reads, exports, search and writes. An accessible plant does not confer access to unrelated organizations behind it.

### Audit and history

Record actor and time for auditable user decisions. Association, launch and phase history retain the meaning of their original event; a declaration is not a phase advance. Stored assessments retain their rubric version so historical judgments are not reinterpreted against a newer rubric. Financial audit requirements belong to the financial feature specification.

### Events and ownership

Domain events use `entity.action` names. Event contracts and subscribers live with their owning code; replay safety and concurrency guarantees must hold at the database boundary, not depend on a handler running once.

Features own their domain entities; shared identifiers do not permit another feature to bypass the owner's mutation rules. See [System Architecture](system-architecture.md) for system-wide constraints.

## Stability

Changing a shared meaning requires cross-feature impact assessment. Field removals and type changes require migration coordination; existing applied migrations and historical ledgers are not rewritten to match a newer design.
