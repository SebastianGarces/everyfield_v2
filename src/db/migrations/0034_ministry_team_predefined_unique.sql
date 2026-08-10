-- OB-015 — one predefined ministry team of each name per plant, enforced by the
-- DATABASE (issue #306 / WS2, required by the HR4 exit comment of 2026-08-09).
--
-- WHY THIS EXISTS. `initializePredefinedTeams` (src/lib/ministry-teams/service.ts)
-- is reachable from two places: the /teams "Set Up Ministry Teams" button and
-- the onboarding finish screen's OB-015 offer. Both guarded it the same wrong
-- way — read "does this church have teams yet?", then loop ten unconditional
-- inserts. `memory/invariants.md` → Transactions names that shape by name:
-- SELECT-then-INSERT is not a concurrency guard. Two accepts a few milliseconds
-- apart (two tabs, or a double submit) both pass the read and the plant lands on
-- /teams with 20 teams and 96 roles. The remedy the same invariant prescribes is
-- the one applied here: make the duplicate unrepresentable with a partial unique
-- index, and put that index in the SAME statement as the rows it speaks for via
-- `ON CONFLICT … DO NOTHING`.
--
-- WHY PARTIAL, ON `type = 'predefined'`. The templates are a closed, named set
-- (`TEAM_TEMPLATES`), so "one Worship team per plant" is a truth about them and
-- not about teams in general. A planter's OWN teams are different: two custom
-- teams may share a name while the planter settles on wording, and a total
-- unique index would answer that with a database error in the middle of a form.
-- The predicate keeps the constraint where the invariant actually holds.
--
-- ORDER MATTERS. Any pre-existing duplicate is demoted FIRST; the index is built
-- second. A build before the demotion would fail the migration outright on the
-- first plant the old race had already reached.
--
-- WHAT THE DEMOTION DOES, AND WHAT IT DOES NOT. Where a church already has more
-- than one predefined team of a name, the EARLIEST row keeps `type =
-- 'predefined'` and the later ones become `type = 'custom'`. Nothing is deleted:
-- a duplicate created by the old race may already carry imported roles,
-- memberships and meetings, and a migration is the wrong place to decide that a
-- planter's team is fiction. A demoted row stays visible on /teams as an
-- ordinary team the planter can rename or pause. There are none in any database
-- today (verified 2026-08-09 against the development branch: 62 ministry_teams
-- rows, 0 duplicate (church_id, name) groups among predefined), so this
-- statement is defensive only.
--
-- EXPAND-ONLY. Nothing is dropped and nothing is rewritten. A build deployed
-- BEFORE this migration keeps working — its unconditional inserts simply start
-- failing on a second initialization instead of duplicating, which is the safer
-- of the two wrong answers — and the build deployed AFTER it works against a
-- database that has not run the migration, minus the guarantee. Deploy in either
-- order.
--
-- ROLLBACK (HR2). Drop what was added. The demotion is NOT reversed: `custom` is
-- a legitimate value that carries no marker saying it was ever a template, and
-- guessing would re-create the duplicates this migration removed. Run in ONE
-- psql session:
--
--   DROP INDEX IF EXISTS "ministry_teams_predefined_name_unique_idx";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0034 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033: the journal is the repository's
-- list of migrations, `drizzle.__drizzle_migrations` is the database's record of
-- what ran, and only the ledger row is deleted. Removing the journal entry
-- instead makes drizzle-kit forget the migration while the ledger still claims
-- it applied, which is unrecoverable by restoring the entry.
--
-- `<0034 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0034_ministry_team_predefined_unique.sql
--
-- Rolling back also un-fixes the race, so the `ON CONFLICT` clause in
-- `initializePredefinedTeams` must be reverted with it — the two are one change.
UPDATE "ministry_teams" SET "type" = 'custom' WHERE "id" IN (
	SELECT t."id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "church_id", "name"
				ORDER BY "created_at", "id"
			) AS rn
		FROM "ministry_teams"
		WHERE "type" = 'predefined'
	) t
	WHERE t.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "ministry_teams_predefined_name_unique_idx" ON "ministry_teams" USING btree ("church_id","name") WHERE "ministry_teams"."type" = 'predefined';
