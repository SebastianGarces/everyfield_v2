-- ONE RULED BATCH — four database-level guards that four services were asking
-- application code to keep: #407 D1 (template forks), #407 D2 (RSVP
-- confirmation tokens), #405 D5 (the subtask self-FK) and #409 D1 (one person
-- per team role). Sequenced AFTER the ledger saga: the #304/#313 renumbering
-- settled on 2026-08-12 and the shared development ledger was reconciled to
-- head 0037, so this file is a plain max(idx)+1 with no forward reconcile owed
-- to any sibling (`memory/invariants.md` → Migrations).
--
-- WHAT THE FOUR HAVE IN COMMON. Every one of them replaces a SELECT-then-INSERT
-- — the shape `memory/invariants.md` → Transactions refuses by name — or, in
-- the tasks case, an absence of any check at all. Each DDL statement below
-- ships in the same change as the `ON CONFLICT` clause that speaks for it, in
-- the service that owns the write. They are one change and revert together: an
-- index without its clause turns a race into a 500, and a clause without its
-- index is "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" on every call.
--
--   1. message_templates_church_fork_unique_idx       #407 D1  forkTemplate
--   2. meeting_confirm_tokens_pending_unique_idx      #407 D2  createConfirmationToken
--   3. tasks_parent_task_id_tasks_id_fk               #405 D5  (DDL only)
--   4. team_memberships_role_active_unique_idx        #409 D1  assignMember
--
-- ORDER MATTERS THREE TIMES. Each guard is preceded by the statement that makes
-- the existing rows able to satisfy it. A build before the repair fails the
-- whole migration on the first plant the old races had already reached.
--
-- EXPAND-ONLY. Nothing is dropped and no column is rewritten. A build deployed
-- BEFORE this migration keeps working — its unguarded inserts start failing on
-- a duplicate instead of writing one, which is the safer of the two wrong
-- answers — and the build deployed AFTER it works against a database that has
-- not run the migration, minus the guarantee. Deploy in either order.
--
-- ROLLBACK (HR1/HR2). Reversible in ONE psql session. The three repairs are NOT
-- reversed: a nulled dangling parent, a deleted superseded token and a
-- deactivated duplicate membership all carry no marker saying what they were,
-- and guessing would re-create exactly the rows this migration removed.
--
--   ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_parent_task_id_tasks_id_fk";
--   DROP INDEX IF EXISTS "team_memberships_role_active_unique_idx";
--   DROP INDEX IF EXISTS "meeting_confirm_tokens_pending_unique_idx";
--   DROP INDEX IF EXISTS "message_templates_church_fork_unique_idx";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0038 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0034: the journal is the
-- repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted. Removing
-- the journal entry instead makes drizzle-kit forget the migration while the
-- ledger still claims it applied, which is unrecoverable by restoring the entry.
--
-- `<0038 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0038_partial_unique_guards_and_subtask_fk.sql
--
-- Rolling back also un-fixes three races, so the `ON CONFLICT` clauses in
-- `forkTemplate`, `createConfirmationToken` and `assignMember` must be reverted
-- with it.
--
-- ============================================================================
-- 1. #407 D1 — one fork of a system template per church.
-- ============================================================================
--
-- WHY. Copy-on-write forking (`src/lib/communication/templates.ts`) read "does
-- a fork already exist?" and inserted one when the answer was no. Two edits of
-- the same system template a few milliseconds apart both passed the read, and
-- `getTemplates()` — which hides a system row once the church has forked it —
-- then rendered BOTH forks: the planter sees the template they just edited
-- twice, with no way to tell which copy the next edit lands on.
--
-- WHY THIS ONE RAISES INSTEAD OF REPAIRING. A duplicate fork holds a planter's
-- own edits — subject lines, body copy — and the two copies have diverged by
-- construction, because divergence is what forking is for. Every automatic
-- answer (keep the older, keep the newer, keep the longer) silently discards
-- authored work, and a migration is the wrong place to decide that. So the
-- check names the offending pairs and stops, on the same terms as
-- `assertProtectedTablesAreSafe()` in the dev-seed wipe: stop and let a human
-- merge the two, then re-run.
--
-- THE OPERATOR'S TWO EXITS, if this RAISEs:
--   (a) merge by hand — copy whichever body is wanted onto the surviving row,
--       then `DELETE FROM message_templates WHERE id = '<the other one>'`; or
--   (b) if the duplicate is untouched boilerplate, delete it outright.
-- Prove either with the SELECT inside the block below, which must return zero
-- rows before `pnpm db:migrate` will proceed.
--
-- Verified 2026-08-13 against the shared development branch: 0 offending
-- groups, so this block is defensive only.
DO $$
DECLARE
	offenders text;
BEGIN
	SELECT string_agg(
		format('(church_id=%s, source_template_id=%s, %s rows)', d.church_id, d.source_template_id, d.n),
		'; '
	)
	INTO offenders
	FROM (
		SELECT "church_id", "source_template_id", count(*) AS n
		FROM "message_templates"
		WHERE "source_template_id" IS NOT NULL
			AND "church_id" IS NOT NULL
		GROUP BY "church_id", "source_template_id"
		HAVING count(*) > 1
	) d;

	IF offenders IS NOT NULL THEN
		RAISE EXCEPTION 'migration 0038: duplicate template forks exist, so message_templates_church_fork_unique_idx cannot be built: %', offenders
			USING HINT = 'Merge each group by hand and delete the surplus rows, then re-run pnpm db:migrate. A fork holds a planter''s own edits, so this migration will not pick a winner for you.';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_church_fork_unique_idx" ON "message_templates" USING btree ("church_id","source_template_id") WHERE "message_templates"."source_template_id" is not null;--> statement-breakpoint
-- ============================================================================
-- 2. #407 D2 — one UNANSWERED confirmation token per (meeting, person).
-- ============================================================================
--
-- WHY. `createConfirmationToken` (`src/lib/communication/confirmation.ts`) is
-- called once per recipient by `sendCommunication`, and it was the same
-- SELECT-then-INSERT. Two sends of one meeting invitation — a resend, a
-- double-submitted compose form — minted a second pending token for every
-- person, and the planter's RSVP tracking then showed two unanswered invitations
-- for one invitee. The EXPIRY path reached the same state with no race at all:
-- an expired pending row failed the freshness test, so the service inserted a
-- SECOND pending row and left the first standing.
--
-- WHY THIS ONE REPAIRS. A token is machine-minted plumbing, not authored
-- content: every duplicate resolves the same invitation and the same attendance
-- row, so collapsing a group loses nothing a planter wrote. The survivor is the
-- one that expires LATEST (ties broken by the newest `created_at`, then by id
-- so the statement is deterministic) — the most recently issued link, which is
-- the one the most recent invitation email carried.
--
-- THE COST, NAMED. A superseded token's URL stops working. It would have worked
-- until this migration, because `resolveConfirmation` looks a token up by its
-- own string and every duplicate pointed at the same meeting. An invitee
-- holding an older email therefore gets "Invalid confirmation link" and has to
-- use the newer one. That is the price of the constraint, it is one-time, and
-- it is preferred to leaving a state the service can no longer produce.
DELETE FROM "meeting_confirmation_tokens" WHERE "id" IN (
	SELECT t."id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "meeting_id", "person_id"
				ORDER BY "expires_at" DESC, "created_at" DESC, "id"
			) AS rn
		FROM "meeting_confirmation_tokens"
		WHERE "status" = 'pending'
	) t
	WHERE t.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_confirm_tokens_pending_unique_idx" ON "meeting_confirmation_tokens" USING btree ("meeting_id","person_id") WHERE "meeting_confirmation_tokens"."status" = 'pending';--> statement-breakpoint
-- ============================================================================
-- 3. #405 D5 — tasks.parent_task_id is a self-FK, ON DELETE CASCADE.
-- ============================================================================
--
-- WHY. The column carried no foreign key at all, so a parent id naming no task
-- was representable — and a subtask whose parent does not exist is invisible
-- work: `topLevelTasksOnly()` filters it out of `/tasks` on purpose, and its
-- only other route is the parent's detail view. It still counts in
-- `getTaskCounts`, so the planter sees a number they cannot reconcile with a
-- list, and no surface can close the row.
--
-- WHY CASCADE, GIVEN THE PRODUCT SOFT-DELETES. `deleteTask` stamps `deleted_at`
-- on a parent and its children in one statement, so this cascade fires only for
-- the paths that remove rows outright — `planWipe()`'s seed sweep and hand-run
-- repairs — where the alternative is an FK violation mid-wipe or an orphan.
-- `set null` was the other candidate and is worse: it promotes a checklist item
-- to a top-level task because of a delete it had nothing to do with, so work
-- the planter never created appears in the list the moment its parent leaves.
--
-- THE REPAIR. Any dangling parent is nulled rather than deleted — a subtask is
-- real work somebody typed, and a top-level task is where a planter can finally
-- see and close it. It is the one repair here that makes rows MORE visible, not
-- less. Self-referencing keys are dropped from `planWipe()`'s ordering by
-- construction, so adding this FK does not change the seed wipe's plan.
--
-- Verified 2026-08-13 against the shared development branch: 0 dangling rows,
-- so this statement is defensive only.
UPDATE "tasks" SET "parent_task_id" = NULL WHERE "parent_task_id" IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM "tasks" p WHERE p."id" = "tasks"."parent_task_id"
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- 4. #409 D1 — one person per team role.
-- ============================================================================
--
-- WHY. A `team_roles` row is a seat. `getTeam` resolves its occupant with
-- `memberships.find((m) => m.roleId === role.id)` and the roles tab renders one
-- person beside it, one Filled/Open badge and one Remove control — but nothing
-- above the database held that to one row. `assignMember` asked only whether
-- THIS person already held the role, so two planters assigning two DIFFERENT
-- people to one open seat both succeeded. The loser's person was assigned,
-- counted by `getTeamCountsForPeople`, absent from the roles tab (`find`
-- returns whichever row Postgres hands back first) and unremovable, because the
-- only Remove button belongs to whoever the read happened to pick.
--
-- WHY PARTIAL, ON `status = 'active'`. The seat is single only while occupied.
-- Every past holder stays on the table as an `inactive` row — that is what
-- `removeMember` writes and what `assignMember` reactivates on a re-assignment
-- (F8) — so an unqualified unique index would make a role fillable exactly once
-- in its life.
--
-- WHY `(role_id)` ALONE. A role belongs to one church, so `(church_id, role_id)`
-- would be a wider key for the same rule and would let a forged church id claim
-- a second active seat. Same reasoning as
-- `phase_prompt_answers_transition_unique_idx`.
--
-- THE REPAIR. Where a role already has more than one active membership, the
-- EARLIEST one keeps the seat and the later ones are set `inactive` with
-- today's date as their `end_date` — exactly what `removeMember` writes, so the
-- rows land in the shape every reader already understands. Nothing is deleted:
-- an assignment is a record that a person served, and the history is worth
-- keeping. The earliest row wins because it is the assignment the planter made
-- deliberately and the one whose Filled badge has been on the screen longest;
-- the later ones were invisible on the roles tab and could not be removed
-- through the UI at all, which is the bug being repaired.
--
-- THIS ONE IS NOT DEFENSIVE, AND THE FIGURE IS NAMED. Measured 2026-08-13
-- against the shared development branch: 8 roles carry more than one active
-- membership and this statement deactivates 34 of the 44 active membership rows
-- on it. Every one of them is FIXTURE — a single "Core Leader" role per eval
-- church, seeded in one instant on 2026-08-09 by
-- `scripts/seed-phase-engine-eval.ts`, which invents that role (it is in no
-- `TEAM_TEMPLATES` entry) and hangs the whole core group off it. The fixture is
-- what #409 D1 rules against, not evidence against the ruling: those 34 people
-- are precisely the invisible, unremovable assignments described above. THE
-- SEED SCRIPT WAS UPDATED IN THIS SAME RELEASE, because it had to be: it
-- inserted its membership rows in one multi-row INSERT against one role id and
-- would have failed on this index the next time it ran, leaving the eval
-- fixture unregenerable. `scripts/seed-phase-engine-eval.ts` now mints one
-- "Core Leader N" role per core-group member, so every membership it writes
-- holds a seat of its own.
UPDATE "team_memberships"
SET "status" = 'inactive',
	"end_date" = CURRENT_DATE,
	"updated_at" = now()
WHERE "id" IN (
	SELECT t."id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "role_id"
				ORDER BY "created_at", "id"
			) AS rn
		FROM "team_memberships"
		WHERE "status" = 'active'
	) t
	WHERE t.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_role_active_unique_idx" ON "team_memberships" USING btree ("role_id") WHERE status = 'active';
