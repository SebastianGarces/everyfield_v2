# Transactions / Atomicity

Why and how, for the Transactions / Atomicity rules in [`../invariants.md`](../invariants.md).

**Source:** `src/db/index.ts`, `src/lib/invitations/core.ts`, `src/lib/onboarding/create-church.ts`, `src/app/(dashboard)/dashboard/confirm-leadership.ts`, `src/lib/meetings/service.ts`, `src/lib/tasks/events.ts`, `src/lib/phase-engine/transitions/service.ts`, `src/lib/launch/outcome.ts`, `src/lib/people/household.ts`

## The model

`drizzle-orm/neon-http` speaks one HTTP request per statement, so there is no session to hold a transaction open. `db.batch([...])` is the only atomic unit available: one round trip, all-or-nothing, and **each statement sees the previous one's writes** — which is what makes it usable as a guard, and where the traps are.

Two failure modes, two tools:

- **Replay** (one request retried after a crash) → ordering + idempotency. Marker last, every earlier step redo-safe.
- **Concurrency** (two requests in flight) → ordering does nothing; both pass the same SELECT. You need a DB-level guard: a (partial) unique index, a compare-and-set as statement one, or `SELECT … FOR UPDATE`.

## The subquery trap

A compare-and-set serialises only writers of the **same row**. An `EXISTS (… another table …)` predicate is a snapshot read: two requests updating two different rows contend on nothing, both subqueries evaluate true, both commit, and under READ COMMITTED the second one's dependent statement silently matches nothing.

**The lock does not extend to the predicate, and this is the failure mode that keeps coming back.** `FOR UPDATE` on table A serialises writers of that row; a subquery about table B is still a snapshot read taken before the wait. When the loser unblocks, EvalPlanQual re-checks only the row that changed — A — so the B-predicate answers from the pre-wait snapshot and both requests proceed.

`acceptInvitationAs()` shows both halves. It batches the claim (`pending → accepted`) with the FK write, whose `WHERE` re-asserts the claim, so a lost claim writes nothing — but that holds only against a *sequential* second accept, because two accepts of two DIFFERENT invitations for one free oversight slot contend on nothing. What makes it a concurrency guard is `lockTargetRow` (`SELECT … FOR UPDATE` on the row the association writes) as statement ONE, with success gated on the dependent write's rowcount rather than on the claim's.

The initial phase declaration is the same trap one table over: it locked the `churches` row it was about to write and then decided whether to insert by `where not exists (select 1 from phase_transitions …)`. Raced, it wrote two rows, the second reading `from_phase 5 → to_phase 3` — a transition the planter never took, fabricated into the audit trail the table exists to keep honest.

**The remedy is the index, not a better predicate:** a partial unique on `church_id where kind = 'initial_declaration'`, with `on conflict … do nothing` inferred against it. The lock stays, because it is what makes `from_phase` the value the row actually sat at, and the `moved` UPDATE is sourced `from declared d`, so a refused declaration writes nothing at all. The closing `left join declared d on true` returns one row either way, reading `stored_phase` off the LOCKED row, so the loser of a race reports the winner's phase rather than its own stale snapshot.

**A discriminator that only exists in TypeScript cannot be indexed.** Marking the row by writing a reserved sentence into `reason` forces the index predicate to repeat that sentence as a SQL literal, and the day the copy is reworded the index silently stops covering the rows it exists for; `kind` is a stored, CHECK-closed column. Only a live-database race proves this class of bug.

## Why the church batch is one batch

As three awaited statements, a failure at the last left a church LINKED to a planter with no privacy row and **nothing could repair it**: the retry is refused by the "you already have a church" guard, while every `canAccessFeatureData` read answered from a row that did not exist.

The batch is not the concurrency guard here — `linkUserToChurchFilter` is, and a real one, because both requests update the same `users` row. What it cannot undo is the loser's own church insert, so `discardChurchStatements` sweeps it afterwards under a `NOT EXISTS` on the link, so cleanup can only ever delete a church nobody is linked to.

## Why the planter-seat No is locked too

Two team members of a planterless plant write two DIFFERENT rows — `users` for a Yes, `churches` for a No — so without the church row lock they contend on nothing. As a bare `UPDATE churches SET leadership_status = 'no_planter'` the No wins by arriving last, and `handleMeetingAttendanceFinalized` reads `churchHasNoPlanter` first, so a plant that had just acquired a planter got no post-meeting follow-up or evaluation tasks at all. The one path left unguarded is an answer from whoever already holds the seat: once filled, `canAnswerLeadershipQuestion` admits only the planter, so there is no second writer.

## The snapshot CTE must be a dependency of the write

A plain CTE evaluates lazily. In `with current as (select … for update), updated as (update …), journal as (insert … from updated join current …)` nothing pulls `current` until the journal — *after* the UPDATE. `FOR UPDATE` then skips the row the current command just wrote, `current` comes back empty, the join matches nothing, and the journal row is silently absent.

Fix it structurally: the UPDATE reads the snapshot (`update launches l … from current c where l.id = c.id`) and returns the old values itself. `recordLaunchOutcomeStatement` is the reference; `setLaunchDateStatement`'s `inserted` CTE forces `current` first via its `not exists` predicate, and deleting that predicate breaks its journal the same silent way.

## `insert … select` as the existence check

`createHouseholdWithHead` batches the household INSERT and the person UPDATE that makes that person its head. The INSERT is an `insert … select` whose row source is the person row itself, filtered by the full person predicate (`church_id`, `id`, `deleted_at is null`), which makes the existence check structural: a bad `personId` — wrong tenant, soft-deleted, forged — selects zero rows, so no household is written and there is no pre-flight SELECT for a concurrent delete to slip behind. Do not "improve" it by adding one.

The order cannot be reversed, because `persons.household_id` FKs `households.id`; the id is minted in JS so both statements can carry it. Drizzle's insert-from-select emits the FULL insertable column list in table-definition order, so the select must supply every `households` column in that exact order.

**Accepted residual:** the two statements take separate READ COMMITTED snapshots inside the batch, so a person soft-deleted *between* them yields inserted-household + zero-row-update and the batch COMMITs both; the JS throw on the empty `returning()` fires after COMMIT and rolls nothing back. Carried deliberately: the window is two statements wide in one round trip, and the orphan is inert.

## Marker-last

`church_meetings.actual_attendance` is written only by `finalizeAttendance()`, so non-null *is* the idempotency key — and because its compare-and-set runs after the downstream emit, a meeting can never be finalized without its follow-up tasks. Duplicates are blocked by `tasks_meeting_evaluation_unique_idx`.
