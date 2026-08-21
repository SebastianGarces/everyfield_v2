# Seats & Tenancy

Why and how, for the Seats & Tenancy rules in [`../invariants.md`](../invariants.md).

**Source:** `src/db/schema/user.ts`, `src/lib/auth/tenancy.ts`, `src/lib/auth/access.ts`, `src/db/migrations/0050_user_seat.sql`, `0051_drop_user_role.sql`, `0052_person_user_link.sql`, `src/lib/people/account-person.ts`

Ruled 2026-08-20 (#185, rows 185 and 185 (4)); built by #494. The FRD is
`product-docs/features/accounts-and-seats/frd.md`.

## The shape, and why neither half reads alone

Five flat role names became **three seats in three tenancies**. `users.role` was one column that
answered two questions at once — what may this account do, and whose account is it — and adding a
tenancy meant adding a role and a matrix column. The seat says the first, the tenancy FK already on
the row says the second, and the same three words now mean the same three things in a plant, a
sending church and a network.

The trap that follows is worth naming: **`seat = 'owner'` says nothing about whose owner.** Every
authority rule reads the PAIR. `isPlantOwner` asks for both halves because `seat === "owner"` alone
admits a sending church's Owner and `churchId !== null` alone admits every Member of the plant.

`NULL` is a value in this column, not a gap: it is what a coach-only account holds, because coaching
is an assignment (`coach_assignments`) that sits beside a seat rather than being one. A NOT NULL
column would have needed a fourth word meaning "none", and every reader would then have to know that
word means the same as absent.

## What replaced the role as the disambiguator

While `role` existed it broke every tie. A row carrying `church_id` AND `sending_network_id` was a
planter because its role said so, and `getAccessibleChurchIds` switched on the role before it looked
at a column. With the role gone the FK IS the answer — so a stray FK stops being noise and becomes a
competing claim.

`oversightOrgOf` is the one place that resolves it, and it answers **only for a row naming exactly
one tenancy FK**. Two named resolves to nothing.

A precedence order was the obvious alternative and is wrong: whichever FK won, the other tenancy's
reach would be handed to an account with a live claim on it — the hierarchy walk
[multi-tenancy.md](multi-tenancy.md) forbids, arriving through a column instead of a role.

That is also why `isChurchLevelUser` is written positively rather than as `!isOversightUser`. It is
the predicate the privacy toggles are read against and the one the launch readiness ticks refuse
oversight with, so a negation would exempt the two-tenancy defect from BOTH — it names no oversight
org, so the negation is true for it, and the toggles would stop applying to a row that carries an
oversight FK. Stated positively the defect fails closed on both sides, and
`getAccessibleChurchIds`'s plant arm asks the same predicate so the two halves of that one function
cannot disagree.

## Why the index and not a check in code

Ruling 185 (4) is explicit that ownership is "a data defect that must be impossible rather than
detected". Before it, the OB-010 planter claim was a SELECT-then-INSERT: two callers both read "this
plant has no planter" and both wrote one, and every static check passed. Three partial unique
indexes make the loser of that race a unique violation instead of a second Owner.

**Partial on the seat is what keeps the NULLs safe**, and it is the half a careless index gets
wrong. A btree unique index treats NULLs as distinct, so every account with no tenancy FK indexes
separately; the `WHERE seat = 'owner'` then keeps Admins and Members out of the index entirely. Make
the index total, or the column NOT NULL, and the second coach-only account becomes unwritable with
nothing in the application able to say why. `src/db/seat-owner-uniqueness.test.ts` asserts both
halves against a real Postgres, because an index is the only place this rule lives.

## The migration's repair, and the figure behind it

Migration 0050 §1 clears `sending_church_id` and `sending_network_id` from every church-level row.
It is not tidying — it is what makes §3 buildable. Measured 2026-08-20 against the shared
development branch (41 users): **12 planter rows carried both oversight FKs**, copied from their
plant's own org columns. Backfilled to `owner` and left alone, 13 rows would have shared one
`sending_network_id` under `users_sending_network_owner_unique_idx` and the build would have aborted
on the first duplicate, taking the whole migration with it.

Nothing is lost: a plant's sending church and network live on `churches.sending_*_id`, which is
where `getSendingChurchPlantIds` and `getNetworkChurchIds` already read them from. `users` was never
the source.

**Coach rows keep their `church_id`.** Under the seat model that reads as "in this plant, holding
nothing", which is exactly what a coach is — and `getAccessibleChurchIds` answers a seatless account
from `coach_assignments`, so the church set is unchanged. Clearing it would move those accounts'
notification feed and navigation, which is a product change and not this migration's.

## Migrating a role allowlist is BOTH halves, every time

The seat is not an optional extra on a rule that used to name a role. Each of
the five names meant a seat AND a tenancy — `planter` was the Owner seat in a
plant, `sending_church_admin` the Owner seat in a sending church — so a caller
re-pointed at the tenancy alone WIDENS: it admits the seatless row and the org
Member that no role ever mapped to. `isPlantOwner` and `isOrgOwner` are the two
predicates that keep both halves together, and every authority arm goes through
one of them.

The same trap, one level down: `{planter, team_member}` maps to `{owner,
member}` and to nothing else. `admin` is a seat the role model could not
express, so "any seat" is not its translation — the OB-010 claim names the pair
explicitly, and letting a plant Admin claim the Owner seat is a product decision
for the seat-management issue rather than a consequence of this rename.

## The person a seat belongs to (AS-013, #378)

`users.seat` answers what an account may DO. `persons.user_id` answers something
the seat model deliberately does not: **which row in the plant's people IS this
account.** The two are separate columns because they are separate questions, and
conflating them is the mistake this section exists to prevent.

**Why the link had to exist at all.** `ministry_teams.leader_id`, the meeting
guest list and every team assignment reference `persons.id`, and the assignment
dialog is fed by `listPeople`. Nothing tied a `persons` row to an account, so
the planter was the one member of their own plant who could not be put on a
team — they staffed everybody except themselves. It is also the missing half of
AS-006's own-duty verbs: `tasks.own` shipped only because
`tasks.assigned_to_id` references `users.id`, and `teams.own` / `meetings.rsvp`
did not because their subjects are `persons.id`. The subject half now exists;
the rewire is #495+'s and owes the widening argument again rather than
inheriting it.

**Written at CHURCH-GAIN and nowhere else.** `churchCreationStatements`
(`src/lib/onboarding/create-church.ts`) is the one contract for "an account just
gained a plant", and both paths that do it — onboarding step 1 and an invited
planter's registration — spread that tuple whole (ruling 408-4B). Putting the
insert there rather than in each caller is what makes "one spelling" true; a
per-caller insert would be two, and the invited path is the one that would have
silently lacked it.

**It grants nothing, and that is a property to keep, not a coincidence.** A
capability names a seat set and a tenancy requirement; nothing in
`@/lib/auth/seats` reads `persons`, and the auto-fill that seats the planter in
their own Senior Pastor role writes no `users` row at all. The temptation this
guards against is real — "the planter's person record" looks like an identity
claim — but a person row is a CRM record a plant Admin can create, so deriving
authority from one would put seat-granting behind the people list.

**The unique index is church-scoped, not per-account, on purpose.** The row is a
person IN A PLANT, and the residual below says nothing holds an account to one
tenancy — a per-account index would state a rule the rest of the schema does not
keep. Partial on `user_id IS NOT NULL` for the reason the owner indexes are
partial on the seat: a btree unique treats NULLs as distinct, so the plant's
contacts would index separately anyway, and the predicate says so out loud.

**One thing it did NOT replace.** `people/person-user.ts` bridges a person to an
account by ADDRESS, and it stays. The FK is an identity written at church-gain
and covers only accounts that gained a church; the bridge is discovery — "which
people in this plant happen to hold a login" — and answers for everyone else. A
reader who finds both should not collapse them; the bridge retires when every
account-holding person carries the FK, which is a different issue.

## Three tenancies, one value (#500)

`users.role` became a seat plus a tenancy FK, and #494 left the FK half as three
nullable columns that each reader picked apart for itself. That was fine while
only ONE surface cared which tenancy a row named. #500 is the issue that made it
expensive: the seat-invitation flow was written with `churchId: string` threaded
through fifteen call sites — the duplicate check, the cap, the insert, the
`oursFilter` behind the list, the revoke, the resend and the expiry sweep, the
name lookup for the email, the register lookup, the registration planner — and
widening it to a sending church or a network meant either fifteen nullable
fields with a switch at each, or one value.

`tenancyOf` is that value: `{ type, id }` for a row naming EXACTLY ONE FK, and
`null` otherwise. `oversightOrgOf` is now the same resolution with `church`
removed rather than a second walk over the same three columns, so the two can
never disagree about which org a row names — which matters because the
invitation layer and `requireOversightUser` are now scoped by the same fact.

**`tenancyColumns` is the inverse, and it is why the CHECK cannot be got wrong.**
Both writers — the `user_invitations` insert and the `users` insert at
registration — SPREAD it rather than naming a column, so exactly one FK is set
and the other two are explicitly NULL. `num_nonnulls(...) = 1` is then satisfied
by construction rather than by each call site remembering it, and
`org-seat-invitations.test.ts` asserts the insert names no column of its own.

**The `user_invitations` projection IS `TenancyFields`.** The table carries the
same three columns under the same exactly-one CHECK, so an invitation row is
resolved by the same function a session is. That is what let
`describeUserInvitationForRegistration` drop its `innerJoin(churches)` — there is
no ONE table to join any more — and read the tenancy off the row instead.

## Why `tenancy` is a fourth requirement and not `any`

`seat.invitation.manage` predicted its own widening: #495's docblock said the org
side "widens the tenancy here rather than declaring a second verb". The widening
needed a requirement that did not exist. `plant` is too narrow and `any` is too
wide, and the gap between them is one real account: registration mints a plant
Owner with every FK null who creates the plant afterwards. `any` would let that
account through `/settings/team`'s gate onto a screen whose every query has no
subject — a 500 where a redirect belongs. `tenancy` is `tenancyOf(user) !== null`
and admits exactly the two tenancies that can HOLD a seat.

`seat.manage` deliberately stays `any`, unchanged. Its tenancy half is asked one
layer down by `seatActorFromSession`, which now refuses only an account naming no
tenancy at all — and that mint is also where the two-tenancy defect fails closed,
because `tenancyOf` answers nothing for it.

## What an org Member is, and what the seat does NOT change

Ruling 185 (3) gives an org Member full read parity with the Owner. That is
already how the code is built, and the important thing is that it is STRUCTURAL
rather than a list kept in step: `getAccessibleChurchIds` resolves the org from
the tenancy FK alone and never asks the seat, so a Member and an Owner of one org
are handed the identical church-id list and every oversight read is built from
it. `requireOversightUser` admits on the same FK. The privacy gate is unchanged
too — an org Member is not `isChurchLevelUser`, so the six `share_*` toggles
reach them for the same reason they reach the Owner.

**So the work was the WRITE side, and it was mostly deletion of a false
equality.** Three surfaces had rendered a control on the strength of the tenancy
alone, because while an org had exactly one account "has this org" and "is its
Owner" were the same row:

- `/oversight/invitations` rendered the association create form and the row's
  resend and revoke to any oversight account. All three are
  `org.invitation.manage`, Owner-only.
- `PlantDetail` rendered `RemovePlantDialog` unconditionally, and its comment
  argued correctly that an admin reaches a plant only through their own org's FK
  — an argument about the PLANT, which is still true. What changed is the READER.
- `/settings/association` admitted on `oversightOrgOf(user)?.type ===
  "sending_church"` and would have served accept, decline and leave to somebody
  all three refuse. It asks `isOrgOwner` now, both halves, like `isPlantOwner`
  beside it.

Each is now a `holdsSeatFor` call on the same verb the action guards with, so the
page and its writes cannot disagree. The server-side refusal was always there;
what was missing was not offering the control.

**And gating the controls exposed a read that was too narrow.** `invitingOrgOf`
had the Owner check baked in, and it scoped the LIST as well as the revoke — so
the moment `/oversight/invitations` grew a read-only variant, that variant showed
an org Member an empty list under copy promising the org's whole history. The
same false equality, one layer down: while an org had one account, "the org's
invitations" and "the Owner's invitations" were the same rows.

It splits into `readableOrgOf` (the FK alone) and `invitingOrgOf` (that,
and-ed with `isOrgOwner`). The 2026-08-04 rule the shared predicate protected —
never show a row whose Revoke will be refused — is not lost; it moves to the
render side, where `canAct` decides both controls from the same verb the action
guards with. The list is now deliberately wider than the verbs on it, which is
what read parity means.

The same defect in its most visible form is the empty state: the oversight index,
`PlantsDirectory` and `SendingChurchesRoster` each offered "Invite a planter" or
"Invite a sending church" as the ONLY thing on the page. All three take a
`canInvite` prop now.

## The removal cascade is a plant's

AS-016's five effects were written for a plant. Two of them — open tasks
reassigned, ministry-team leadership cleared — name tables an org does not have.
For a sending church or a network they are not "empty", they are meaningless:
scoping a `church_id` column by an org's id would read as an effect and be none.
So `removeSeat` batches sessions-delete + marker for an org, and sessions-delete +
`plantRemovalEffects(...)` + marker for a plant.

`plantRemovalEffects` exists so the batch literal still reads as the ordered
effects the redo-safety argument is about, and so the plant-only pair has
somewhere to say why it is plant-only. The marker is LAST in both shapes, which
is the whole of that argument. Two literal `db.batch` calls rather than one with
a spread, because each shape then keeps its exact return type and the marker is
read by its own index rather than by arithmetic on a dynamic array.

The confirmation dialog follows the batch: `REMOVAL_CONSEQUENCES` promises the
task reassignment and the leader slot for a plant and neither for an org.
Promising effects that will not happen is the same defect as hiding ones that
will.

## The residual

Nothing in the schema holds an account to ONE tenancy. A `CHECK (num_nonnulls(church_id,
sending_church_id, sending_network_id) <= 1)` would say it, and would have refused those twelve rows
before they could be repaired, so it is not in 0050. The state therefore stays representable and
every reader fails closed on it — including the notifications audience, which reaches such a row on
the FK alone and COUNTS it as misprovisioned rather than dropping it silently inside a `WHERE`.
Retired by adding that CHECK once no writer can produce one.

## What the seat DECIDES, once #498 landed

`getAccessibleChurchIds` answers what a tenancy REACHES. `@/lib/auth/seats`
answers what a seat may DO there, and the two are deliberately separate: an org
Member reads the same portfolio as its Owner (ruling 185 (3)), so the reach
never branches on the seat.

**Why the table carries a tenancy column.** `seat = 'owner'` says nothing about
whose owner, so a capability names a seat set AND a tenancy requirement, and the
three composite predicates the readers spell by hand fall out of it:
`OWNER_ONLY + "plant"` is `isPlantOwner`, `OWNER_ONLY + "oversight"` is
`isOrgOwner`, `OWNER_ONLY + "church-level"` is `isChurchLevelOwner`. Those three
stay in `tenancy.ts` as the READ side — a page deciding what to render — and the
guard derives the same rule from the sets rather than importing them, so there
is one declaration of each half and no second spelling of the pair.

**Three things are not in either set, and each is marked rather than parked in
`ADMIN_PLUS`:**

- `seats: SEATED` — an own-duty verb (AS-006). The seat half refuses a coach
  (NULL seat) and an oversight account; the SUBJECT half needs the argument, so
  it belongs after the parse. **`tasks.own` is the only one that ships**, and the
  reason is a column: `tasks.assigned_to_id` references `users.id`, so
  `assertMayActOnTask` can ask "is this yours?" once the row is loaded. It runs
  in the SERVICE rather than in the six actions, so `/launch`'s milestone ticks
  are covered too, and `planBulkTaskOperation` applies it PER ROW — a Member
  ticking eight tasks writes the ones they own and gets the rest back named.

  The first round shipped `teams.own` and `meetings.rsvp` the same way and that
  was WRONG, in the direction a capability name hides: `ministry_teams.leader_id`
  and the meeting guest list reference `persons.id`, nothing links a person row
  to an account, and so those two had a floor with nothing above it — every
  Member in the plant reaching every team and every RSVP, which is wider than
  the `teams.write` it was replacing. They are `teams.write` / `meetings.write`
  now: narrower than AS-006 describes, and a team leader holding only a Member
  seat cannot yet make their team's writes. That is the residual in
  [`../invariants.md`](../invariants.md), retired by AS-013's person link.

- `seats: null` — a session is the whole rule. A read, or a write whose row is
  keyed by the caller's own user id. A coach and an org Member reach these ON
  PURPOSE (AS-007, AS-008), which is the answer a per-module matrix would have
  got wrong in at least one module.
- `church.claim` — the OB-010 answer, which GRANTS a seat rather than spending
  one. Its ruled `{owner, member}` pair (no `admin`) stays in
  `onboarding/leadership.ts`; putting it in a set here would make a grant look
  like a permission and invite someone to "reconcile" the two.

**What moved, and what deliberately did not.** Encoding the ruling narrowed some
verbs and widened one. Narrowed: every feature-data write now refuses a plant
Member, and a coach is refused every write including the launch milestone ticks
that `requireChurchLevel` used to admit them to. Widened: the church profile
(`setChurchTimeZoneAction`) went from Owner-only to `ADMIN_PLUS`, which is AS-004
verbatim. Unchanged on purpose: the phase declaration stays the planter's under
the phase engine's own rule, and the seven `isOrgOwner` arms in
`invitations/core.ts` stay Owner-only — the ruling's list names the association
verbs, and those arms are the argument-side half of the same rule, reached only
after the endpoint's own `requireSeat` has already refused everyone else.
