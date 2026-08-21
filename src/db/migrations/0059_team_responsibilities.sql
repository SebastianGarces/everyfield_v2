-- #311 WS1 (MT-002b) — the team responsibilities checklist becomes rows, and
-- `ministry_teams` gains the CLAIM that makes the playbook seed once-ever.
--
-- ORDERING. `when` was raised above 0058's by hand. drizzle-kit stamped this
-- file with a `when` BELOW the migration before it, which `drizzle-kit migrate`
-- reads as already-past: it applies a migration only while the ledger's maximum
-- `created_at` is under its `when`, so the file would have been SILENTLY
-- SKIPPED on every database that already ran 0058 — exit 0, nothing applied
-- (`memory/invariants.md` → Migrations). This migration was first generated as
-- 0058 and REGENERATED as 0059 after #560 landed and took that number, so it is
-- a fresh generate on top of the merged sibling rather than a renamed file: the
-- snapshot chains from 0058's and no operator reconcile is owed, because no
-- database ever applied the earlier number under this tag.
--
-- PURELY ADDITIVE: one new table, one new nullable column, three FKs and two
-- lookup indexes. No backfill, and none is needed — a NULL
-- `responsibilities_seeded_at` is exactly "this team has not been offered its
-- playbook yet", which is true of every row that exists when this applies. The
-- first view of each predefined team claims its own stamp and writes its own
-- rows, so plants created before this migration and after it converge without
-- a one-shot SQL twin.
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