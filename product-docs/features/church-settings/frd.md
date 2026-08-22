# FRD — Church Settings

> Church Settings is the one place a plant corrects itself: who I am (email, password,
> picture) and who we are (name, place, clock, and what the overseeing org is allowed to
> see). No answer captured anywhere in the product is permanent, and oversight sharing
> is a deliberate, legible choice made here.

> **Tracked on the board:** [Church settings #187](https://github.com/SebastianGarces/everyfield_v2/issues/187) — open requirements are its sub-issues. Implementation status is not tracked in this file.

## Feature overview

One route, `/settings`, presented as a settings hub with tabs. This FRD owns two of them:

- **Account** — for every signed-in account, in any tenancy: change email, change
  password, set a profile picture.
- **Church** — for plant seats only: the church profile (name, place, timezone, digest
  schedule, inactivity thresholds) and the sharing panel that governs what an associated
  sending church or network sees.

The hub also hosts the team page and the association area, each owned by its own feature
(the seat-management surface and Oversight). This FRD adds its two tabs beside them; it
does not restate theirs.

Two deliberate absences shape the page. Launch Sunday is edited on the launch page —
the launch entity is its only owner, and a date change there is journaled and
milestone-emitting, which a bare settings field would bypass. And there is no danger
zone: deleting a church or closing an account is a support conversation, not a button.
*(Scope: billing joins the page at Beta — `product-docs/decisions.md` 2026-08-08 §192;
danger zone deferred past alpha and a church logo deferred to document-generation phase 2
— `product-docs/decisions.md` 2026-08-15 §187.)*

## Who reaches what

| Surface | Who | Why this line sits where it does |
|---------|-----|----------------------------------|
| Account tab | Every account — plant, sending church, network, coach-only | Email, password and picture belong to the person, not the tenancy |
| Church tab — profile | Plant **Admin and above** | Running the plant's day-to-day is what the Admin seat is for |
| Church tab — sharing panel | Plant **Owner only** | What the plant shares with its overseers is a relationship decision, and relationship decisions are the Owner-only list |

An Admin sees no sharing panel — the controls are absent, not disabled — and every
sharing action is refused server-side for any seat but the Owner, through the same
single guard every state-changing action calls.

## User-visible behavior

**Account tab** — three self-service controls:

- **Change email.** Email is the login identifier, so the new address must prove itself:
  the change takes effect only after the new address is verified, and the old address is
  told the change happened — the notice is the recovery hook if the change was not the
  owner's doing.
- **Change password.** Requires the current password.
- **Profile picture.** Upload, replace, remove.

Both auth flows ride the same rate-limit guard that sign-in and registration ride — one
implementation, not a second copy.

**Church tab — profile** (Admin and above):

- Church name.
- City and state / region, and an optional street address.
- Timezone: one IANA zone per church, defaulting to `America/Chicago`, never inferred
  from the address — city and region are each optional, so inference fails open for
  exactly the planters who skipped them, and a silently wrong zone is worse than an
  obviously default one. Church-scoped surfaces render dates and relative-day badges in
  the church's zone.
- Digest schedule: the day and hour the digest lands, defaulting to Sunday 16:00 church
  time, whole hours only — an hour is the unit a planter reasons in. The weekday governs
  the weekly cadence; the hour governs daily and weekly alike. The *church* owns when
  the digest lands; each *recipient* still owns whether they get one, through their own
  notification preferences.
- Inactivity thresholds: the warning and alert day counts that drive inactivity signals.

**Church tab — sharing panel** (Owner only):

One row per thing an associated org can see, each in plain language stating what the
sending church or network will and will not see — the copy must not overclaim, because
the org's directory listing is visible regardless of sharing; only feature data inside
it is gated. The rows:

- The pull toggles: the people directory, Meetings, Task Management, Financial
  Tracking, Ministry Teams, facilities, and the wiki.
- The push toggle: activity milestones to oversight recipients.

Turning a toggle off takes effect on the org's next read. It also notifies the
overseeing org's admins with **coarse** wording — "changed what it shares with you" —
never per-toggle: the org learns the relationship moved, without the notice becoming a
surveillance feed of which switch flipped.

## Sharing defaults

- **A plant born from an org invitation starts with every sharing toggle on** — pull and
  push. The acceptance screen states what the overseer will see *before* the planter
  accepts; the acceptance is the consent. The defaults are written by the invitation
  acceptance itself — application-level, in the same acceptance write — while the
  database defaults stay off, so nothing but an informed acceptance ever produces an
  open plant.
- **A self-started plant starts with every toggle off.** No org relationship, nothing
  shared until the Owner says so.

## Functional requirements

| ID | Priority | Requirement |
|----|----------|-------------|
| CS-001 | Must | `/settings` is one route, a hub with tabs; this feature contributes the Account tab and the Church tab beside the team page the seat-management surface owns. |
| CS-002 | Must | Account tab, every account: change email — the new address is verified before it becomes the login identifier, and the prior address is notified of the change. |
| CS-003 | Must | Account tab, every account: change password, requiring the current password. |
| CS-004 | Must | Account tab, every account: upload, replace or remove a profile picture, stored in the same object storage the product's uploads use. |
| CS-005 | Must | Email and password changes ride the same rate-limit guard sign-in and registration ride — one implementation, not a second copy. |
| CS-006 | Must | Church profile, plant Admin and above: edit church name, city, state / region, and an optional street address. |
| CS-007 | Must | The church carries one IANA timezone, default `America/Chicago`, edited on the church profile and never inferred from the address; church-scoped surfaces render dates and relative-day badges in it. |
| CS-008 | Must | The church carries the digest's send day and hour, default Sunday 16:00 church time, whole hours only, edited on the church profile; the weekday governs the weekly cadence and the hour governs daily and weekly alike. Recipient-side digest preferences are untouched — the notification service owns them. |
| CS-009 | Must | Church profile, plant Admin and above: edit the inactivity warning and alert day counts. |
| CS-010 | Must | The sharing panel renders for the plant Owner only — absent for every other seat, not disabled — and every sharing write is refused server-side for any seat but the Owner. |
| CS-011 | Must | The sharing panel presents one row per pull toggle — the people directory, Meetings, Task Management, Financial Tracking, Ministry Teams, facilities, the wiki — plus the activity push toggle, each with plain-language copy stating what the org sees; the copy never overclaims. |
| CS-012 | Must | Turning any sharing toggle off notifies the overseeing org's admins once, with coarse wording naming no individual toggle, on the same org-anchored rail oversight milestone notifications ride. |
| CS-013 | Must | A plant created by accepting an org invitation starts with all sharing toggles on, written by the acceptance itself with the consent stated on the acceptance screen beforehand; a self-started plant starts with all toggles off; database defaults stay off. |
| CS-014 | Must | Launch Sunday appears nowhere on the page; the launch entity owns it and its edits. |
| CS-015 | Should | Each profile field saves independently with visible feedback; a failed save names the field, not the form. |

## Acceptance criteria

1. A plant Member opens `/settings` and finds the Account tab but no church profile and
   no sharing panel; a plant Admin finds the profile but no sharing panel; the Owner
   finds all of it. A sharing write submitted by an Admin without the UI is refused.
2. Changing the email leaves the old address as the login identifier until the new
   address is verified; after verification the new address signs in, the old one does
   not, and the old address received a notice.
3. A password change with the wrong current password is refused, and repeated attempts
   are rate-limited.
4. Editing the church name persists and renders wherever the church is named — the
   dashboard, the org's plants directory — with no second edit surface.
5. With a pull toggle off, the org's per-plant detail shows that section's explain-why
   empty state; turning it on shows the data on the org's next read; turning it off
   again delivers exactly one coarse notification to the org's admins.
6. A plant accepted from an org invitation shows every toggle on at first open of the
   sharing panel, and the acceptance screen stated what the org would see before the
   planter accepted. A self-started plant shows every toggle off.
7. Changing the digest hour changes when the next digest lands, in church time; changing
   the weekday changes which day the weekly digest lands without touching any
   recipient's own digest preference.
8. No control on `/settings` reads or writes Launch Sunday.

## Data entities

This feature owns no new entity. It edits columns on the church record — name, city,
state / region, street address, timezone, digest day and hour, the two inactivity
thresholds — and the sharing rows of the church privacy settings. Street address is
optional and city, state / region and timezone carry the defaults named above; schema
detail belongs to the implementing unit.

## Integration points

- **Oversight**: the pull toggles gate the org's per-plant feature sections; the push
  toggle gates activity milestones to oversight recipients. Consent copy and exposure
  change together.
- **The notification service**: the coarse toggle-off notice and the digest schedule
  ride it; recipient preferences stay its property.
- **Invitations**: the acceptance write sets the invite-origin sharing defaults and the
  acceptance screen carries the consent copy.
- **Launch**: owns Launch Sunday and every edit to it; this page links there rather
  than duplicating the control.
- **The wiki**: the wiki sharing row gates what an associated org reads of the plant's
  wiki.
- **The seat-management surface**: owns `/settings/team`; this FRD only places its tabs
  beside it.

## Non-functional requirements

- Every mutation is tenancy-scoped to the caller's church; no cross-tenant read or
  write.
- Permission is asked of the same single permissions module and guard every
  state-changing action calls — the Owner-only and Admin-and-above sets are data, not
  per-page conditionals.
- Destructive-feeling changes (turning sharing off) apply immediately without a
  confirmation dialog — they are reversible — but the notification makes them legible.

## Non-goals

- Billing and entitlements — joins the page at Beta.
- Church logo upload — document-generation territory; it reuses the same object-storage
  plumbing the profile picture uses when it lands.
- Danger zone (delete church, close account) — a support conversation during alpha.
- Org-side settings (a sending church or network editing its own profile) — the
  seat-management surface's territory, not this page.
