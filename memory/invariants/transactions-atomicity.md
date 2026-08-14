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

## The 0038 batch — three more guards, and the non-obvious half of each

Same shape as the declaration above: an index replaces a SELECT-then-INSERT, and the ON CONFLICT
clause that speaks for it ships in the service that owns the write. What a reader cannot recover
from the SQL is why each one is keyed the way it is.

- **`message_templates_church_fork_unique_idx`** — `(church_id, source_template_id) where
  source_template_id is not null`. Partial because a church's OWN templates carry no source and two
  of them may legitimately share a name. `forkTemplate` claims with `ON CONFLICT … DO NOTHING` and
  re-reads the winner's fork — a fork holds a planter's edits, so the migration RAISEs on
  pre-existing duplicates instead of collapsing them. **The gap:** `church_id` is nullable and NULLs
  never collide, so a sourced row with no church is unconstrained. Nothing writes that shape; a
  `coalesce` expression index would make the ON CONFLICT target unspellable, a worse trade.
- **`meeting_confirm_tokens_pending_unique_idx`** — `(meeting_id, person_id) where status =
  'pending'`. Partial because answered tokens are history: a person may hold a `confirmed` row and a
  `declined` one. `createConfirmationToken` is ONE `ON CONFLICT … DO UPDATE`: a free slot inserts,
  an EXPIRED slot is renewed **in place** — rotating the token and so **invalidating the link the
  earlier email carried**, deliberately — and a LIVE slot fails `setWhere`, writes nothing, and is
  re-read. The expiry branch is what makes this more than a race fix: it reached two pending rows
  with no concurrency at all.
- **`team_memberships_role_active_unique_idx`** — `role_id` ALONE, `where status = 'active'`.
  Partial because a past holder stays as an `inactive` row (an unqualified index would make a seat
  fillable once in its life). **`(church_id, role_id)` was rejected**: a role already belongs to one
  church, so the pair is a wider key for the same rule and a forged church id would buy a second
  seat — `church_id` is for tenant-scoped reads, not identity. The INSERT carries `ON CONFLICT … DO
  NOTHING`; the reactivation UPDATE cannot carry one, so it meets the index as a throw WHEN ANOTHER
  PERSON HOLDS THE SEAT — and it carries `status = 'inactive'` in its own `WHERE` (a compare-and-set,
  re-evaluated against the winner's committed row under the row lock) so a SAME-PERSON double submit
  onto a previously-held seat is refused by an empty `returning()` rather than by nothing at all,
  which is what two UPDATEs of one row raise. `isSeatConflict`
  (`src/lib/ministry-teams/membership-conflict.ts`) recognises the throw — through
  `isUniqueViolation` (`src/db/errors.ts`), never a second copy of that predicate.

### The index it replaced

**`team_memberships_active_unique` — `(team_id, person_id, role_id) where status = 'active'` — is
GONE, dropped by 0039.** The seat index strictly subsumes it: one active row per role implies one
per any triple containing that role, and `role_id` is NOT NULL, so there is no NULL hole where the
wider key would still bite. But it was not inert while it stood: `ON CONFLICT (role_id) WHERE status
= 'active'` names the SEAT index as its arbiter — one index, never all of them — so under a real
race the INSERT proceeded past the arbiter's pre-check, met the triple first (lower OID, uncovered
by the DO NOTHING), blocked on the winner's tuple and RAISED 23505 about two runs in three. Dropping
the index converts that raise into the designed `INSERT 0 0`. Consequences:

- **One index, one recognised name.** `isSeatConflict` is `isUniqueViolation(error,
  TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE)` and nothing else. Do not re-add the subsumed index, do not
  widen the `ON CONFLICT` target, do not add a pre-flight SELECT — the last two are the
  SELECT-then-INSERT shape this file refuses by name, and the first re-adds the raise.
  `ruled-guards.test.ts` §4c fails if a second `isUniqueViolation` branch appears or the dropped
  index is spelled again; §4d asserts off the RENDERED table (`getTableConfig`) that
  `team_memberships` carries EXACTLY ONE unique index, keyed `role_id` alone, predicated on the
  `status = 'active'` the `ON CONFLICT` clause repeats — because ANY second unique index is a
  non-arbiter whatever it is called, and a name-grep cannot see that.
- **ONE decider for which sentence, reached by BOTH refusal paths** (`seatRefusalMessage`): each
  reads the seat's active holder — the same person is `PERSON_ALREADY_ASSIGNED_MESSAGE`, anybody
  else is `ROLE_ALREADY_FILLED_MESSAGE`. An index→sentence table cannot work: `role_id` alone
  reports no intent, and without the read the same-person double-submit was told "Someone filled it
  while this page was open" — false, with the person they picked. The read is POST-refusal and
  decides wording only; the index still decides who gets the seat.
- **The race suite runs each case three times** because a race's outcome is timing-dependent. One
  green run of `role-seat-race.test.ts` is not evidence.

**Where the refusal actually gets tested.** Recognition reads a driver error, and it arrives in two
shapes: a `db.batch([...])` throws the driver's `NeonDbError` directly (constraint name in
`message`), while a single-statement write is wrapped in Drizzle's `Failed query: …` with the driver
error on `cause` and no constraint name in the wrapper. Reading only one misses half the call sites.
`membership-conflict.ts` is a SERVER-ONLY SIBLING of the import-free copy leaf — it imports
`isUniqueViolation` and the index-name constant, so it cannot sit in `membership-copy.ts`, which a
`"use client"` dialog imports. `membership-conflict.test.ts` pins both shapes with no database;
`role-seat-race.test.ts` proves both refusal paths end to end, live.

## Running the live suites

Every race suite (`declaration-race`, `teams-init-race`, `fork-and-token-race`, `role-seat-race`,
`subtask-parent-fk`) is opt-in behind `LIVE_DB_TESTS=1` and a reachability probe. `db` is a neon-http
client and cannot reach a plain Postgres over TCP, so the switch is `scripts/live-db-endpoint.ts` —
a **test-runner preload, not a seam in the app**: it points the driver's fetch endpoint at
`local-neon-http-proxy` (`NEON_HTTP_PROXY_URL`, default `http://localhost:4444/sql`), same driver,
same `db.batch`, same SQL. `pnpm test:live` loads it with `--import`; node:test propagates execArgv
to the per-file child processes, so it lands before any suite imports `@/db`.

**Why not in `src/db/index.ts`.** It was there for one round, behind a hostname allowlist — a
data-shape guess evaluated on every production request, where an accidentally-set
`NEON_HTTP_PROXY_URL` would have redirected live traffic. The decision is "this process is a
live-suite run", which the test runner knows and the application never needs.
`src/db/live-suite-coverage.test.ts` fails if any module under `src/` touches `neonConfig`.

**Do not "fix" this with `drizzle-orm/node-postgres`.** `db.batch()` exists only on the batching
drivers and is the transaction in every write path here — a suite on a driver without it tests code
the application never executes. The `Live DB Race Suites` CI job stands the proxy up beside a
`pgvector/pgvector:pg16` service, applies the migration files, and runs `LIVE_DB_TESTS=1 pnpm
test:live` — the explicit list, NOT `pnpm test`, because the corpus tests assert against seeded wiki
articles this database does not have. The proxy's mock control plane needs a
`neon_control_plane.endpoints` table in the target database or every query answers HTTP 500
"Control plane request failed", which looks like a connection fault and is not.

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
