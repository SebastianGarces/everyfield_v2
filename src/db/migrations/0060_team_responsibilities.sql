-- #311 WS1 (MT-002b) — the team responsibilities checklist becomes rows, and
-- `ministry_teams` gains the CLAIM that makes the playbook seed once-ever.
--
-- ORDERING. `when` is 1787552241967 — the tail (0059) plus ONE SECOND, written
-- by `scripts/restamp-migration.ts` during `pnpm db:generate` (#566). Not a day:
-- every +24h hand-stamp pushed the journal further ahead of wall-clock time,
-- and this file carried one for two rebases before the script existed.
--
-- THIS MIGRATION HAS BEEN RENUMBERED TWICE, which is why the block below is
-- owed. It was minted as 0058, regenerated as 0059 when #560 took that slot,
-- and regenerated again as 0060 when #587 took 0059 — each time a fresh
-- `db:generate` on top of the merged sibling rather than a renamed file, so the
-- snapshot chain is honest.
--
-- ONE STATEMENT WAS DELETED FROM THE GENERATED FILE BY HAND, deliberately:
-- `ALTER TABLE "plant_assessments" ADD COLUMN "planter_seen_at"`. #587's 0059
-- ships WITHOUT a snapshot, so `drizzle-kit generate` diffed against 0058 and
-- re-emitted that track's column here. Left in, a database applying 0059 then
-- 0060 aborts on `column "planter_seen_at" ... already exists`. The SNAPSHOT
-- keeps it — it describes the schema after both migrations, which is true.
--
-- PURELY ADDITIVE otherwise: one new table, one new nullable column, three FKs
-- and two lookup indexes. No backfill, and none is needed — a NULL
-- `responsibilities_seeded_at` is exactly "this team has not been offered its
-- playbook yet", which is true of every row that exists when this applies.
--
-- ===========================================================================
-- OPERATOR RECONCILE — REQUIRED BEFORE `pnpm db:migrate` ON ANY DATABASE THAT
-- RAN THIS BRANCH BEFORE IT MERGED (memory/invariants.md → Migrations).
-- ===========================================================================
--
-- `drizzle-kit migrate` decides by `when` against the ledger's MAXIMUM
-- `created_at` and never asks whether THIS migration's own row is present, so a
-- database that applied the DDL under an OLD number is invisible to it: the
-- statements below re-run and the first raises Postgres 42P07,
-- `relation "team_responsibilities" already exists`.
--
-- RUN THE DETECTION QUERY RATHER THAN WAITING FOR THAT ERROR — you will not be
-- shown it. `drizzle-kit migrate` swallows the driver error and exits non-zero
-- with an unfinished spinner and nothing on stdout or stderr (measured on
-- 0058's track, 2026-08-21).
--
--   DETECTION — is the DDL already in place?
--
--     SELECT to_regclass('team_responsibilities') AS table_present;
--
--   EXIT A — NULL (every fresh clone, every restore, and production). Nothing
--   to reconcile. Run `pnpm db:migrate` normally; the statements below apply
--   cleanly.
--
--   EXIT B — NON-NULL. Exactly one database can be in this state: the shared
--   development branch, where this DDL was applied on 2026-08-21 so the Vercel
--   preview could read the table, under the tag `0059_team_responsibilities` at
--   created_at 1787552240967. That ledger row is GONE — #587's own 0059 took
--   that timestamp — so the DDL is applied with nothing naming it. Do NOT
--   re-run the statements. This is an ATTENDED ledger write
--   (`memory/contracts/db.md` → Migration ledger vs journal): a human inserts
--   the row this file should have, in one psql session,
--
--     INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
--     VALUES ('<sha256 of THIS file, byte for byte, from the deployed commit>',
--             1787552241967);
--
--     *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
--   and verifies with `pnpm db:migrate`, which must then apply nothing.
--   `shasum -a 256 src/db/migrations/0060_team_responsibilities.sql` gives the
--   hash; take it from the commit you are deploying, because amending any
--   comment in this file changes it.
--
-- ROLLBACK (loses only what this migration made possible — the checklist rows
-- and the record of which teams were offered one):
--
--   DROP TABLE IF EXISTS "team_responsibilities";
--   ALTER TABLE "ministry_teams" DROP COLUMN IF EXISTS "responsibilities_seeded_at";
--
-- Re-applying afterwards re-offers every predefined team its playbook, because
-- the stamp that said otherwise went with the column. That is the honest
-- consequence of rolling back and not a defect to guard.

CREATE TABLE "team_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD COLUMN "responsibilities_seeded_at" timestamp;--> statement-breakpoint
ALTER TABLE "team_responsibilities" ADD CONSTRAINT "team_responsibilities_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_responsibilities" ADD CONSTRAINT "team_responsibilities_team_id_ministry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_responsibilities" ADD CONSTRAINT "team_responsibilities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_responsibilities_church_id_idx" ON "team_responsibilities" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "team_responsibilities_team_id_idx" ON "team_responsibilities" USING btree ("team_id");