# FRD — Accounts & Seats

> Accounts & Seats is how a person gets into EveryField and what they may do once inside: three
> seats — Owner, Admin, Member — that mean the same three things in a plant, in a sending church
> and in a sending network, plus coaching as an assignment that sits beside a seat rather than
> replacing one.

> **Tracked on the board:** [Accounts & Seats #185](https://github.com/SebastianGarces/everyfield_v2/issues/185) — open requirements are its sub-issues. Implementation status is not tracked in this file.

## Feature overview

An account belongs to exactly one **tenancy** — one plant, one sending church, or one sending
network — and holds exactly one **seat** in it. The seat vocabulary is deliberately the one every
collaboration product uses: an **Owner** who holds the relationship decisions, an **Admin** who runs
the day-to-day, a **Member** who participates. A planter appointing a co-leader and a network
director appointing a second staffer are the same act, learned once.

**Coaching is not a seat.** A coach reaches a plant through a `coach_assignments` row the plant's
Owner or Admin creates, and reads it. An assignment is orthogonal to a seat: an account may hold a
seat in its own tenancy and any number of coach assignments elsewhere, and its access is the union
of the two.

The governing constraint (System Architecture → hierarchical access control) is unchanged by the
seat model: an account whose tenancy is an oversight org sees **aggregate metrics only, never an
individual person record**, whatever its seat, and every oversight read stays gated by the plant's
`share_*` toggles.

## Core concepts

### The three tenancies

| Tenancy | The account's home | Who the Owner is |
|---|---|---|
| **plant** | `church_id` | The planter — the person leading that church plant |
| **sending church** | `sending_church_id` | The staff member who holds the sending church's account |
| **sending network** | `sending_network_id` | The staff member who holds the network's account |

One account, one tenancy. Moving a person from one tenancy to another is a support request, not a
product flow (see non-goals).

### The three seats

| Seat | In a plant | In an oversight org |
|---|---|---|
| **Owner** | Everything an Admin may do, plus the Owner-only list below. Exactly one per tenancy. | Everything an Admin may do, plus the Owner-only list below. Exactly one per tenancy. |
| **Admin** | The plant's church profile, and writes across the people directory, Meetings, Task Management and Ministry Teams. May invite Members and coaches. | May invite, revoke and resend the org's invitations, and manage the org's roster. |
| **Member** | Reads the plant, and writes only their own duties: their meeting RSVPs, their own tasks, their own ministry team. | Full read parity with the Owner. No action that changes anything. |

**The Owner-only list**, identical in shape across all three tenancies:

- The plant's sharing toggles.
- Accepting an association, leaving one, and severing one.
- Scheduling a launch.
- Appointing a seat, demoting a seat, and removing a seat.
- Org settings and billing, wherever those land.

**Team leadership is not a seat.** A ministry team's leader is `MinistryTeam.leader_id`, and the
writes that leadership grants derive from that column — one implementation, not a second copy. A
Member who leads a team gets the leader's writes on that team and nothing else; appointing them
Admin is a separate decision with a different meaning.

### Coaching

A coach reaches only the plants named by their own active `coach_assignments` rows, read-only, and
sees the plant's own records the way the plant's own team does — a coach is not oversight and is not
subject to the `share_*` toggles.

Any account may hold assignments: a coach-only account (no tenancy, no seat), a Member of one plant
coaching another, or an oversight seat holder coaching a plant inside their own portfolio. In that
last case the two reaches stay separate and both apply: the assignment gives coach-level read of
that one plant's own records, and every *oversight* surface the same person opens stays aggregate,
`share_*`-gated, and free of individual person records. *Why:* the two reaches come from different
consents — the planter's invitation, and the plant's sharing toggles — and neither may borrow the
other's scope.

## User-visible behavior

**Owner (plant)** — the planter:

- Invites people into their plant as Admin or Member, and invites their coach.
- Appoints a Member to Admin, demotes an Admin to Member, and removes anyone's seat.
- Ends a coach assignment.
- Keeps every relationship decision: sharing, association, launch scheduling.

**Owner (oversight org)**:

- The same seat management for their org's staff, plus the org's invitation lifecycle and roster.

**Admin**:

- Runs the plant's or the org's day-to-day work, including inviting Members and coaches, but sees no
  seat-appointment or seat-removal control at all.

**Member (plant)**:

- Reads the plant and acts on their own duties. Every surface they may only read shows them no write
  affordance — no button, no menu item, no inline editor, no empty-state call to action.

**Member (oversight org)**:

- Sees exactly what the org's Owner sees: the plants directory, each plant's aggregate detail, the
  plant-health portfolio, and — in a network — the sending-church roster and its drill-down. Sees no
  invitation, revoke, resend, sever, roster-edit or seat control anywhere.

**Coach**:

- Sees an **Assigned plants** section in the navigation whenever they hold at least one active
  assignment, and reads each assigned plant with every write affordance hidden.

**An account with no seat and no assignment** reaches no plant or org data. It signs in to a state
that says it has no access and points at the support path.

## Screens and workflows

| Route | Audience | Content |
|---|---|---|
| `/settings/team` | plant Owner and Admin; org Owner and Admin | The tenancy's people: invite form, pending invitations with revoke and resend, the seat roster, and — for the Owner only — appoint, demote and remove controls |
| `/register?invitation=<token>` | an invited person with no account | Registration that consumes the invitation and lands the person in the tenancy with the invited seat |
| Navigation → **Assigned plants** | any account holding an active coach assignment | One entry per assigned plant |

`/settings/team` is a page of the settings hub, beside the account, church, sharing and association
pages. Admins reach it; the appointment and removal controls inside it are Owner-only and are not
rendered for an Admin.

### The seat invitation flow

1. An Owner or Admin enters an email address and picks a seat (Admin or Member).
2. The invitation is created, addressed to that one address, single-use, expiring, and its token is
   stored hashed.
3. The invitee receives an email carrying the token and registers through it. Registration is the
   only way a seat invitation is answered.
4. Registration grants the tenancy and the seat in one write. For a plant invitation it also links a
   person record — the recipe the people directory owns: match the address inside that plant, and
   create the person record when no match exists.

An address that already holds an account is refused with **the one neutral message** — the same
message every other refusal downstream of target resolution uses, saying nothing about whether an
account exists. The invitation surface shows one neutral success notice, renders no copyable
registration link, and caps how often one address may be addressed inside the expiry window, exactly
as the org invitation surface does — one implementation, not a second copy.

### The coach invitation flow

A coach invitation is answered by an account, not only by a stranger. Where the address holds an
account, accepting adds the `coach_assignments` row and changes nothing else — no seat, no tenancy,
no data moved. Where it holds no account, the invitee registers and the assignment is created at
registration. The planter's invitation is the consent; no second confirmation from the invitee's own
tenancy is asked for.

### Removing a seat

The Owner removes a seat from `/settings/team`, behind an explicit confirmation. The removal:

- Revokes the person's sessions.
- Clears their tenancy and their seat, leaving the account itself intact.
- Leaves their person record in the people directory untouched, including its team memberships — a
  person record and an account are separate things, and losing the account must not lose the roster.
- Reassigns their open tasks to the Owner. *Why:* an unassigned task disappears from every "my work"
  view, so the plant would silently lose the commitment.
- Clears their ministry-team leadership, so the team reads as having an open leader slot. *Why:*
  leadership is a decision about a person, not a queue that must drain — the open slot asks the
  Owner to make it, where a silent hand-off would not.

An Owner may not remove their own seat. Ending a coach assignment is the same act with a smaller
blast radius: the assignment goes inactive, the coach loses that plant, and nothing else changes.

## Functional requirements

| ID | Level | Requirement |
|---|---|---|
| AS-001 | Must | Every account holds exactly one seat — `owner`, `admin` or `member` — in exactly one tenancy, named by the account's `church_id`, `sending_church_id` or `sending_network_id`. A coach-only account holds a tenancy of none and a seat of none. |
| AS-002 | Must | Exactly one Owner per tenancy, enforced by the database: one partial unique index per tenancy FK, conditioned on the Owner seat. *Why:* ownership is the authority every other rule defers to, so a second Owner is a data defect that must be impossible rather than detected. |
| AS-003 | Must | The Owner-only actions are, in every tenancy: sharing toggles, association accept / leave / sever, launch scheduling, seat appointment, seat demotion, seat removal, and org settings and billing. An Admin is refused each of them server-side and is shown no control for them. |
| AS-004 | Must | A plant Admin may edit the church profile and write across the people directory, Meetings, Task Management and Ministry Teams, and may invite Members and coaches. |
| AS-005 | Must | An org Admin may create, revoke and resend the org's invitations and manage the org's roster. |
| AS-006 | Must | A plant Member reads the plant and writes only their own duties: their meeting RSVPs, their own tasks, and their own ministry team. Any wider write a Member performs comes from `MinistryTeam.leader_id`, never from the seat. |
| AS-007 | Must | An org Member reads everything the org's Owner reads — the plants directory, per-plant aggregate detail, the plant-health portfolio, and a network's sending-church roster and drill-down — and is refused every action that changes state. Their reads stay gated by each plant's `share_*` toggles and expose no individual person record. |
| AS-008 | Must | Coaching is an assignment, never a seat: a coach reaches a plant only through an active `coach_assignments` row, read-only, and reads the plant's own records without `share_*` gating. |
| AS-009 | Must | An account's access is the union of its seat in its own tenancy and its active coach assignments, with each reach keeping its own scope. An oversight seat holder who coaches a plant in their own portfolio reads that plant's own records through the assignment while every oversight surface stays aggregate and gated. |
| AS-010 | Must | Seat invitations are register-only. An address holding an account is refused with the one neutral account-not-invitable message; the token is stored hashed; one inviting tenancy may address one email at most the capped number of times per expiry window; a pending invitation carries revoke and resend; no surface renders a copyable registration link, and no notice or list row says whether an account exists. One implementation shared with the org invitation surface, not a second copy. |
| AS-011 | Must | Coach invitations accept an account. Where the address holds one, accepting writes the `coach_assignments` row and changes no seat, no tenancy and no data. Where it holds none, the invitee registers and the assignment is written at registration. |
| AS-012 | Must | An invitation grants its tenancy FK and its seat at registration, in the same write that creates the account, so that outside registration a seat is granted in exactly one place — the seat-management surface. |
| AS-013 | Must | A plant seat invitation also links a person record at registration: match the invited address among the plant's people, otherwise create the record — the linking recipe the people directory owns. |
| AS-014 | Must | `/settings/team` exists as a page of the settings hub and shows: the invite form, the pending invitations list with revoke and resend, and the seat roster. Reachable by Owner and Admin. |
| AS-015 | Must | The Owner appoints a Member to Admin and demotes an Admin to Member from `/settings/team`. The controls are not rendered for an Admin and the actions are refused server-side for one. |
| AS-016 | Must | The Owner removes any other seat from `/settings/team` behind an explicit confirmation. The removal revokes sessions, clears the tenancy FK and the seat, leaves the account row and the person record intact, reassigns the person's open tasks to the Owner, and clears any ministry-team leadership they hold so the team shows an open leader slot. |
| AS-017 | Must | An Owner may not remove their own seat; the control is absent and the action is refused. |
| AS-018 | Must | The Owner, and the Admin who created it, may end a coach assignment from `/settings/team`. The assignment goes inactive and the coach loses that plant on the next request. |
| AS-019 | Must | Permission is decided in one place: a single module stating the Owner-only and Admin-and-above sets as data, and a single guard every state-changing action calls. A test walks every export of every `"use server"` module and fails when one reaches its work without the guard. *Why:* a per-module permission matrix drifts the moment two modules disagree, and the export list is the auth surface. |
| AS-020 | Must | Every write affordance is hidden — not merely disabled — for a read-only context, on every surface in the read-only surface checklist below. A read-only context is a coach on an assigned plant, an org Member on any surface, and a plant Member on a surface they may read but not write. |
| AS-021 | Must | Navigation shows an **Assigned plants** section whenever the account holds at least one active coach assignment, listing one entry per assigned plant, and hides it entirely when none exist. |
| AS-022 | Must | An account with no tenancy and no active assignment reaches no plant or org data and sees a signed-in state that explains it has no access and names the support path. |
| AS-023 | Should | The seat roster shows, per person, their name, their address, their seat and when they joined, so an Owner auditing access can read it in one pass. |
| AS-024 | Nice | An Owner sees a plant's coach list beside its seat roster on the same page, rather than in a separate area. |

## Read-only surface checklist

AS-020 is verifiable only against a list. Every surface below is checked in a read-only context
before the sweep is complete; the right-hand column names what must not render.

| Surface | Must not render for a read-only context |
|---|---|
| Global navigation and command palette | Any "new" or "create" entry, the seat-management page, and any destructive action entry |
| Dashboard | Quick-action tiles, "add" cards, inline phase-advance controls, dismiss and edit affordances on cards |
| People directory (list) | New person, import, bulk actions, per-row edit and delete menus, stage drag-and-drop |
| Person detail and its activity, assessments, communication and teams tabs | Edit, delete, change-stage, add-note, new-assessment, assign-to-team and send-message controls |
| Meetings (list) | New meeting, per-row edit and delete menus |
| Meeting detail and its attendance, evaluation, invitations, logistics, outcomes and analytics tabs | Edit meeting, record and finalize attendance, submit evaluation, send invitations, edit logistics, record outcomes — a Member's own RSVP is the one control that stays |
| Tasks (list, detail, templates) | New task, import template, per-row complete, assign, edit and delete — a Member's own assigned task keeps its own complete control |
| Ministry Teams (list, detail, meetings, responsibilities, training tabs, health, org chart) | New team, add and remove member, assign role, set leader, edit responsibilities, record training — a team leader's writes on their own team stay, derived from `MinistryTeam.leader_id` |
| Communication (list, compose, history, templates, template editing, message detail) | Compose, send, schedule, new template, edit template, delete |
| Documents | Upload, generate from template, rename, delete |
| Launch | Schedule launch, edit launch date, edit milestones, record outcome |
| Phase | Advance phase, declare phase, answer an attestation, dismiss an insight |
| Wiki (article and progress) | Edit article, create church article, and any authoring entry point |
| Notifications | Preference editing that belongs to another account; a person's own preferences stay their own |
| Settings — account | Nothing hidden: an account always edits its own account |
| Settings — church profile | Every field control, for a Member and for a coach |
| Settings — sharing | Every toggle, for anyone but the Owner |
| Settings — association | Accept, decline, leave and sever, for anyone but the Owner |
| Settings — team | The whole page for a Member and a coach; appointment, demotion and removal controls for an Admin |
| Oversight — plants directory and plant detail | Remove-from-org, and any control that writes to the plant |
| Oversight — invitations | Create, revoke and resend, for an org Member |
| Oversight — sending-church roster and drill-down | Invite, remove and roster-edit controls, for an org Member |

## Acceptance criteria

- A tenancy admits exactly one Owner: an attempt to write a second one fails at the database, not
  only in application code.
- An Admin opening `/settings/team` sees the invite form and the pending list, and sees no appoint,
  demote or remove control. Posting those actions as an Admin is refused server-side.
- A seat invitation addressed to an email that already holds an account is refused with the same
  message an invitation to an uninvitable account produces, and the surface reveals nothing else.
  Addressing one email past the cap inside the window is refused, counting every status.
- A seat invitation addressed to a stranger, followed through the emailed link, produces an account
  in the inviting tenancy with the invited seat and — for a plant — a linked person record, matched
  by address where one existed.
- A coach invitation accepted by an account that already holds a seat elsewhere produces exactly one
  new `coach_assignments` row, and leaves the account's tenancy and seat unchanged.
- An oversight seat holder with an assignment on a plant in their portfolio reads that plant's own
  records through the assigned-plant entry, and the same session on `/oversight/plants/[id]` still
  sees aggregates only, gated by that plant's toggles, with no individual person record anywhere.
- Removing a seat: the removed person's next request has no session; their account row and their
  person record still exist; their open tasks are assigned to the Owner; any team they led shows an
  open leader slot; and they no longer appear in the seat roster.
- An Owner sees no control to remove themselves, and the action is refused when posted.
- Every export of every `"use server"` module either calls the shared guard or is proven not to
  change state — asserted by a test over the export list, which fails when a new action is added
  without it.
- Every row of the read-only surface checklist is walked in a coach session and in an org-Member
  session, and no listed affordance renders.
- Navigation shows **Assigned plants** for an account with an active assignment and omits the
  section for an account with none.

## Data entities (feature-owned)

**The seat on an account.** An account carries a seat — `owner`, `admin` or `member`, nullable for
a coach-only account — beside the three tenancy FKs it already carries. The pair (tenancy FK, seat)
is the whole authorization input; nothing else on the account grants access. Three partial unique
indexes, one per tenancy FK and each conditioned on the Owner seat, enforce AS-002.

**user_invitations** — one table for both kinds of invitation into an account. Each row carries the
invited address, exactly one of the three tenancy FKs (a CHECK enforces exactly one, the same shape
the association audit uses), the `kind` (`seat` or `coach`), the invited `seat` (`admin` or
`member`, and null for a coach invitation — a CHECK ties the two: a seat invitation has a seat, a
coach invitation has none), the hashed token, the inviting account, a status, an expiry and
timestamps. It is distinct from the org-to-org invitation table, which creates an association and
never an account.

**coach_assignments** is consumed here, not redefined: this feature owns the write paths — creating
an assignment from an accepted coach invitation, and ending one — and the assignment's shape stays
where it is.

Church, Person and the org-to-org invitation are shared entities owned elsewhere; this FRD only
consumes them.

## Integration points

- **Registration** — the one place outside seat management where a seat is granted. The register
  form carries the invitation token end-to-end, and the grant happens in the same write that creates
  the account.
- **The people directory** — a plant seat invitation links a person record at registration using the
  directory's own match-or-create recipe, one implementation, not a second copy. The link is the
  same one the directory owns; this feature is a caller.
- **Ministry Teams** — leadership writes derive from `MinistryTeam.leader_id`; seat removal clears
  that column where the removed person held it. Team membership rows point at person records and are
  untouched by seat changes.
- **Task Management** — seat removal reassigns the removed person's open tasks to the Owner.
- **Oversight** — the org-side seats are the accounts every oversight surface serves; the Owner-only
  list is where the association and sever authority now lives. Aggregate-only and `share_*` gating
  are unchanged by the seat model.
- **Launch** — scheduling a launch is Owner-only.
- **The notification service** — every audience that picks recipients by who a person is picks them
  by tenancy and seat, and any assignment-derived audience reads `coach_assignments`.
- **The Communication Hub, Meetings, the people directory, Task Management, Ministry Teams, the
  wiki, the document-templates catalog, the Phase Engine** — each consumes the single guard rather
  than testing seats itself.

## Non-functional requirements

- Tenancy: every read and every action is scoped to the caller's own tenancy or to a plant they hold
  an active assignment on. No seat widens the aggregate-only rule for oversight.
- Authorization is decided once, at one guard, ahead of any parse — an unauthenticated caller and an
  under-privileged one are answered the same way for a malformed argument as for a well-formed one.
- Invitation surfaces reveal nothing about whether an address holds an account, in any notice, list
  row, caption or refusal.
- Hidden, not disabled: a read-only context is told what it may do by what it can see, never by a
  greyed control it must try.
- Seat changes take effect on the next request; no surface caches a seat across one.

## Success metrics

A plant runs with more than one account: the planter appoints at least one Admin and invites at
least one Member who signs in and completes a duty. An oversight org runs with more than one
account. Qualitatively, no planter asks how to give their co-leader access, and no support request
arrives asking why a removed person can still sign in.

## Non-goals

- **Ownership transfer.** Handing the Owner seat to someone else, and the planter-takeover path on a
  plant with no Owner, are their own work.
- **A bespoke Member duties dashboard.** A Member's duties surface through the same screens everyone
  else uses; a purpose-built home for them is out of the first release.
- **A per-module permission matrix.** Permissions are two named sets and one guard; a per-feature
  grid of capabilities is explicitly rejected.
- **Moving an account between tenancies in-app.** A person who changes plants or orgs is handled by
  support.
- **More than one seat per account.** One account, one home tenancy; overlap is expressed by coach
  assignments only.
- **Org billing and org settings screens.** The Owner-only rule for them is stated here so it does
  not have to be re-decided; the screens themselves belong to their own work.
- **Custom or per-person permissions.** Three seats, no exceptions list.

## Open questions

None.
