# Transactions / Atomicity

Why and how, for the Transactions / Atomicity rules in [`../invariants.md`](../invariants.md).

**Source:** `src/db/index.ts`, `src/lib/invitations/core.ts`, `src/lib/onboarding/create-church.ts`, `src/app/(dashboard)/dashboard/confirm-leadership.ts`, `src/lib/meetings/service.ts`, `src/lib/tasks/events.ts`, `src/lib/phase-engine/transitions/service.ts`, `src/lib/launch/outcome.ts`, `src/lib/people/household.ts`

## The model

`drizzle-orm/neon-http` speaks one HTTP request per statement, so there is no session to hold a transaction open. `db.batch([...])` is the only atomic unit available: one round trip, all-or-nothing, and **each statement sees the previous one's writes** — which is what makes it usable as a guard, and where the traps are.

Two failure modes, two tools:

- **Replay** (one request retried after a crash) → ordering + idempotency. Marker last, every earlier step redo-safe.
- **Concurrency** (two requests in flight) → ordering does nothing; both pass the same SELECT. You need a DB-level guard: a (partial) unique index, a compare-and-set as statement one, or `SELECT … FOR UPDATE`.

**Accepted residual, and it is a property of the batch:** `createHouseholdWithHead`'s two statements take separate READ COMMITTED snapshots inside the batch, so a person soft-deleted *between* them yields inserted-household + zero-row-update and the batch COMMITs both; the JS throw on the empty `returning()` fires after COMMIT and rolls nothing back. Carried deliberately: the window is two statements wide in one round trip, and the orphan is inert.

## The subquery trap

A compare-and-set serialises only writers of the **same row**. An `EXISTS (… another table …)` predicate is a snapshot read: two requests updating two different rows contend on nothing, both subqueries evaluate true, both commit, and under READ COMMITTED the second one's dependent statement silently matches nothing.

**The lock does not extend to the predicate, and this is the failure mode that keeps coming back.** `FOR UPDATE` on table A serialises writers of that row; a subquery about table B is still a snapshot read taken before the wait. When the loser unblocks, EvalPlanQual re-checks only the row that changed — A — so the B-predicate answers from the pre-wait snapshot and both requests proceed.

`acceptInvitationAs()` shows both halves. It batches the claim (`pending → accepted`) with the FK write, whose `WHERE` re-asserts the claim, so a lost claim writes nothing — but that holds only against a *sequential* second accept, because two accepts of two DIFFERENT invitations for one free oversight slot contend on nothing. What makes it a concurrency guard is `lockTargetRow` (`SELECT … FOR UPDATE` on the row the association writes) as statement ONE, with success gated on the dependent write's rowcount rather than on the claim's.

The initial phase declaration is the same trap one table over: it locked the `churches` row it was about to write and then decided whether to insert by `where not exists (select 1 from phase_transitions …)`. Raced, it wrote two rows, the second reading `from_phase 5 → to_phase 3` — a transition the planter never took, fabricated into the audit trail the table exists to keep honest.

**The remedy is the index, not a better predicate:** a partial unique on `church_id where kind = 'initial_declaration'`, with `on conflict … do nothing` inferred against it. The lock stays, because it is what makes `from_phase` the value the row actually sat at, and the `moved` UPDATE is sourced `from declared d`, so a refused declaration writes nothing at all. The closing `left join declared d on true` returns one row either way, reading `stored_phase` off the LOCKED row, so the loser of a race reports the winner's phase rather than its own stale snapshot.

**A discriminator that only exists in TypeScript cannot be indexed.** Marking the row by writing a reserved sentence into `reason` forces the index predicate to repeat that sentence as a SQL literal, and the day the copy is reworded the index silently stops covering the rows it exists for; `kind` is a stored, CHECK-closed column. Only a live-database race proves this class of bug.
