# FRD — Oversight (Sending Church & Network)

> Origin: discovery on #186 (2026-08-03), plus the #274 permission rulings. The backend for this
> feature predates the FRD — schema (sending_networks, sending_churches, organization_invitations,
> church_privacy_settings), the invitation/association service, hierarchical access control, and
> privacy gating all exist. This FRD defines the user-facing behavior that makes that backend real,
> plus the one entity it was missing (association audit). Status lives on the board (parent issue
> #186), never in this file.

## Feature overview

Sending churches and networks ("oversight orgs") steward the church plants associated with them.
The feature gives oversight admins a portfolio view of their plants and the invitation lifecycle
that creates associations — and gives planters control over that association: they see, answer,
and can end it. The governing constraint (System Architecture → hierarchical access control):
**oversight sees aggregate metrics only, never individual person records**, and per-feature
sharing is the plant's opt-in.

## User-visible behavior

**Oversight admin** (`sending_church_admin`, `network_admin`):

- Sees a directory of associated plants and can open a per-plant page of aggregate,
  privacy-gated sections. Where a plant has not enabled sharing for a feature, the section shows
  an empty state that says why it is hidden and that the plant controls it — never a bare blank.
- Manages invitations (create, list with status including declined, revoke) — and can remove a
  plant from the org, behind an explicit confirmation, with the plant notified.
- A network admin additionally sees a roster of the network's member sending churches.

**Planter**:

- Has a dedicated association area in settings: pending invitations (accept / decline), current
  association(s), and the ability to leave an org, behind an explicit confirmation, with the org
  notified.
- Sees a persistent dashboard reminder while an association invitation is unanswered — the
  association is important; the planter should always know one is pending.
- A newly invited planter can register via an invite link that carries the invitation token, and
  arrives already associated.

## Screens and workflows

| Route | Audience | Content |
|---|---|---|
| `/oversight/plants` | oversight admins | Directory: plant name, location, planter, phase, launch countdown, association provenance |
| `/oversight/plants/[id]` | oversight admins | Per-plant detail: privacy-gated aggregate sections; explain-why empty states; **Remove from org** action (confirm + notify) |
| `/oversight/invitations` | oversight admins | Create / pending list / revoke; declined visible as status (board: #23) |
| `/oversight/sending-churches` | network admins only | Roster: member sending church, plant count, pending invitations |
| Settings → association area | planter | Pending invitations (accept / decline), current associations, **Leave org** action (confirm + notify) |
| Dashboard | planter | Persistent reminder card while an invitation is unanswered |

`/oversight` (index) and `/oversight/health` exist and are unchanged by this FRD.
`/oversight/settings` does **not** ship in alpha (see non-goals).

## Functional requirements

| ID | Level | Requirement |
|---|---|---|
| OV-001 | Must | Plants directory at `/oversight/plants`: every accessible plant with name, location, planter, phase, launch countdown, association provenance. |
| OV-002 | Must | Plant detail at `/oversight/plants/[id]`: aggregate-only sections (people counts, meeting cadence, task health, …) each gated by the plant's corresponding `share_*` toggle; ungated sections show an empty state explaining why data is hidden and who controls it. |
| OV-003 | Must | Invitation surface for admins: create (email + target org), pending/sent list scoped to the caller's org, revoke, declined shown as status. Register form carries the invitation token end-to-end. *(Board: #23, amended 2026-08-03.)* |
| OV-004 | Must | Planter association area in settings: pending invitations with accept/decline, current associations listed. |
| OV-005 | Must | Persistent dashboard reminder for the planter while an association invitation is unanswered; dismissed only by answering. |
| OV-006 | Must | Decline notifies the inviting org (own-org event, consent-exempt rail) and appears as declined status on their invitations list. |
| OV-007 | Must | Disassociation from both sides: planter leaves from the settings area; admin removes a plant from the plant detail page. Both behind type-to-confirm; both notify the other side. |
| OV-008 | Must | Association audit: an `association_events` record is written on every accept and on every disassociation (either side), **for every invitation type — including `sending_church_to_network`** (ruled #351, 2026-08-09). Expand-only; no read UI required for alpha beyond OV-011. |
| OV-009 | Must | Sending-churches roster at `/oversight/sending-churches` for network admins: member sending church, plant count, pending invitations. |
| OV-010 | Must | Permissions (ruled #274): only the plant's **planter** may accept an invitation or sever the plant's association; only the **org's admin** may sever from the org side. Non-planter members of the target church can do neither. |
| OV-011 | Should | Association history section on the plant detail page, read from `association_events`. |
| OV-012 | Must | Sending-church answering surface (ruled #304, 2026-08-09): a sending-church **admin** whose church has a pending `sending_church_to_network` invitation can accept or decline it in-app from their association/settings area; non-admin members are rejected server-side. Every invitation type that can name an existing account has an in-app answering surface. |
| OV-013 | Must | Sending-church sever (ruled #351, 2026-08-09): a sending-church admin can leave their network behind a type-to-confirm dialog; the sever is audited and the network is notified — OV-007 symmetry for the org tier. |

## Acceptance criteria

- An oversight admin sees exactly the plants their org is associated with in `/oversight/plants`;
  a plant with all sharing off still appears in the directory (the listing is not privacy-gated —
  System Architecture invariant) but its detail sections show explain-why empty states.
- No oversight surface renders an individual person record, name, or contact — aggregates only.
- A planter with a pending invitation sees it in settings and on the dashboard reminder; accepting
  associates the church (planter role required); declining removes the reminder, sets the
  invitation's status to declined, and notifies the inviting org.
- A planter can leave an org and an admin can remove a plant — each only through its
  type-to-confirm dialog; afterwards the plant leaves the org's directory and the other side is
  notified. Both writes produce an `association_events` row.
- A `team_member` of the target church attempting to accept or sever is rejected.
- A network admin sees their member sending churches; a sending-church admin cannot reach
  `/oversight/sending-churches`.

## Data entities (feature-owned)

**association_events** — append-only audit of the association lifecycle: a **discriminated
subject** (`subject_type` = `church` | `sending_church`, per-subject nullable FKs, CHECK exactly
one set — ruled #351), org (type + id), event (`associated` / `disassociated`), acting user,
source invitation (nullable — associations can predate invitations), timestamp. Written by accept
and by every severing path, for every invitation type. Schema detail belongs to the implementing
unit (risk:high — migration).

Shared entities (Church, organization_invitations, church_privacy_settings) are owned elsewhere;
this FRD only consumes them.

## Integration points

- **Notifications**: decline and disassociation ride the existing oversight milestone rail;
  own-relationship events to the org follow the established consent-exempt pattern (like
  invitation-accepted). Notifications to the planter are church-role notifications, not subject
  to oversight gating. The rail's recipient anchor is **generalized** (ruled #351): exactly one
  of church / sending church / network, under a discriminator + CHECK on the one notifications
  table — org-only milestones ("a sending church joined your network") ride the same rail, not a
  parallel table.
- **Auth/access**: all oversight reads go through the existing access-control layer
  (`canAccessFeatureData`); OV-010's permission rules extend the invitation service's authority
  checks.
- **Registration**: the invite link carries the invitation token into the register form (board: #23).
- **Launch (future)**: the portfolio will eventually surface launch progress once launch becomes a
  first-class entity (board: #271); out of scope here.

## Non-functional requirements

- Tenancy: every action and read is scoped to the caller's org or church; no cross-org leakage.
- Consent copy must not overclaim: the directory listing is visible regardless of sharing; only
  feature data inside it is gated (existing invariant — exposure and copy change together).
- Empty states are explanatory, never blank; destructive actions are type-to-confirm.

## Success metrics

Feeds the alpha exit condition (decision #193): at least one network admin checking `/oversight`
unprompted; qualitatively, an admin can answer "how are my plants doing?" without asking a planter.

## Non-goals (alpha)

- `/oversight/settings` — dropped from the nav; org profile/admin management belongs with core
  team accounts (board: #185).
- Planter-side per-feature sharing (pull) toggles — church settings scope (board: #187).
- Audit read UI beyond OV-011; audit backfill for pre-FRD associations (impossible — not recorded).
- Any per-person visibility for oversight, under any toggle.

## Open questions

None — discovery (2026-08-03) closed them; permission questions were ruled in #274.
