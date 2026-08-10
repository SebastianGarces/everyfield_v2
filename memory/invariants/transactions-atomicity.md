# Transactions / Atomicity

Why and how, for the Transactions / Atomicity rules in [`../invariants.md`](../invariants.md).

**Source:** `src/db/index.ts`, `src/lib/invitations/core.ts`, `src/lib/onboarding/create-church.ts`, `src/app/(dashboard)/dashboard/confirm-leadership.ts`, `src/lib/meetings/service.ts`, `src/lib/tasks/events.ts`, `src/lib/phase-engine/transitions/service.ts`

## The model

`drizzle-orm/neon-http` speaks one HTTP request per statement, so there is no session to hold a transaction open. `db.batch([...])` is the only atomic unit available: one round trip, all-or-nothing, and **each statement sees the previous one's writes** — which is what makes it usable as a guard, and where the traps are.

Two failure modes, two tools:

- **Replay** (one request retried after a crash) → ordering + idempotency. Marker last, every earlier step redo-safe.
- **Concurrency** (two requests in flight) → ordering does nothing; both pass the same SELECT. You need a DB-level guard: a (partial) unique index, a compare-and-set as statement one, or `SELECT … FOR UPDATE`.

## The subquery trap

A compare-and-set serialises only writers of the **same row**. An `EXISTS (… another table …)` predicate is a snapshot read: two requests updating two different rows contend on nothing, both subqueries evaluate true, both commit, and under READ COMMITTED the second one's dependent statement silently matches nothing.

**The lock does not extend to the predicate, and this is the failure mode that keeps coming back.** `FOR UPDATE` on table A serialises writers of that row; a subquery about table B is still a snapshot read taken before the wait. When the loser unblocks, EvalPlanQual re-checks only the row that changed — A — so the B-predicate answers from the pre-wait snapshot and both requests proceed. Three worked examples now, and none of them looked wrong:

`acceptInvitationAs()` shows both halves. It batches the claim (`pending → accepted`) with the FK write, whose `WHERE` re-asserts the claim, so a lost claim writes nothing — but that held only against a *sequential* second accept. Two accepts of two DIFFERENT invitations for one free oversight slot both committed until `lockTargetRow` (`SELECT … FOR UPDATE` on the row the association writes) became statement ONE and success was gated on the dependent write's rowcount rather than the claim's. Raced by `scripts/g3-oversight-model.ts` §3d case H (#265 r3).

### The third one: the initial phase declaration (#306, OB-005)

`declareInitialPhaseStatement` locked the `churches` row `FOR UPDATE` as statement ONE — the row its own UPDATE writes, so that half was right — and then decided whether to insert with `where not exists (select 1 from phase_transitions p where p.church_id = c.id and p.reason = <const>)`. Different table, so the same trap. Raced 3× against the dev DB with different `toPhase` values: 2 of 3 runs wrote TWO rows, and the second read `from_phase 5 → to_phase 3` — a transition the planter never took, fabricated into the audit trail OB-005 exists to keep honest.

The remedy is the index, not a better predicate: `phase_transitions.kind` (migration 0033) + `phase_transitions_initial_declaration_unique_idx`, a partial unique on `church_id where kind = 'initial_declaration'`, and `on conflict (church_id) where kind = 'initial_declaration' do nothing` inferred against it. The lock stays, because it is what makes `from_phase` the value the row actually sat at. The `moved` UPDATE is still sourced `from declared d`, so a refused declaration writes nothing at all, phase change included, and the final `select … from current c left join declared d on true` returns one row either way — `transition_id` null means refused and `stored_phase` is read off the LOCKED row, so the loser of a race reports the winner's phase rather than its own stale snapshot.

**A discriminator that only exists in TypeScript cannot be indexed.** The first cut marked the row by writing a reserved sentence into `reason` and comparing against a TS constant; an index predicate would have to repeat that sentence as a SQL literal, and the day the copy is reworded the index silently stops covering the rows it exists for. `kind` is a stored, CHECK-closed column, and `isInitialDeclaration` / `hasInitialPhaseDeclaration` read it. The reserved reason survives as display copy and stays refused by `transitionPhaseSchema.refine()`, so a planter cannot type a row that READS like a declaration in the history list.

The proof is `src/lib/phase-engine/transitions/declaration-race.test.ts` — a live-DB test (skipped without `DATABASE_URL`), because no SQL-string assertion can see this class of bug.

## Why the church batch is one batch (#198)

As three awaited statements, a failure at the last left a church LINKED to a planter with no privacy row and **nothing could repair it**: the retry is refused by the "you already have a church" guard, while every `canAccessFeatureData` read answered from a row that did not exist.

The batch is not the concurrency guard here — `linkUserToChurchFilter` is, and a real one, because both requests update the same `users` row. What it cannot undo is the loser's own church insert, so `discardChurchStatements` sweeps it afterwards under a `NOT EXISTS` on the link, so cleanup can only ever delete a church nobody is linked to.

## Why the planter-seat No is locked too (#307, OB-010)

Two team members of a planterless plant write two DIFFERENT rows — `users` for a Yes, `churches` for a No — so without the church row lock they contend on nothing. The No is the one that was missed, and it is not cosmetic: as a bare `UPDATE churches SET leadership_status = 'no_planter'` it won by arriving last, and `handleMeetingAttendanceFinalized` reads `churchHasNoPlanter` first, so a plant that had just acquired a planter got no post-meeting follow-up or evaluation tasks at all.

The one path left unguarded is an answer from whoever already holds the seat: once filled, `canAnswerLeadershipQuestion` admits only the planter, so there is no second writer.

## The snapshot CTE must be a dependency of the write (#305, WS2)

A plain CTE evaluates lazily. In `with current as (select … for update), updated as (update …), journal as (insert … from updated join current …)` nothing pulls `current` until the journal — *after* the UPDATE. `FOR UPDATE` then skips the row the current command just wrote, `current` comes back empty, the join matches nothing, and the journal row is silently absent. Fix structurally: the UPDATE reads the snapshot (`update launches l … from current c where l.id = c.id`) and returns the old values itself. Reference: `recordLaunchOutcomeStatement` (`src/lib/launch/outcome.ts`), pinned by `outcome.test.ts`; `setLaunchDateStatement`'s `inserted` CTE forces `current` first via its `not exists` predicate — deleting that predicate breaks its journal the same silent way.

## Marker-last (`finalizeAttendance`)

`church_meetings.actual_attendance` is written only by `finalizeAttendance()`, so non-null *is* the idempotency key — and because its compare-and-set runs after the downstream emit, a meeting can never be finalized without its follow-up tasks. Duplicates are blocked by `tasks_meeting_evaluation_unique_idx`.
