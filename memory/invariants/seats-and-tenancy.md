# Seats & Tenancy

Why and how, for the Seats & Tenancy rules in [`../invariants.md`](../invariants.md).

**Source:** `src/db/schema/user.ts`, `src/lib/auth/tenancy.ts`, `src/lib/auth/access.ts`, `src/db/migrations/0050_user_seat.sql`, `0051_drop_user_role.sql`

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
  it belongs after the parse. For `tasks.own` it is writable —
  `tasks.assigned_to_id` references `users.id`. For `teams.own` and
  `meetings.rsvp` it is NOT: `ministry_teams.leader_id` and the meeting guest
  list reference `persons.id`, and no column links a person row to an account
  until AS-013's registration link lands. That is the residual in
  [`../invariants.md`](../invariants.md), and it is why those two verbs ship
  narrower than before (a coach and oversight are now refused) but not yet as
  narrow as AS-006 describes.
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
