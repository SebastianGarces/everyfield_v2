-- T-015 — `task_dependencies`: a task may wait on one or more prerequisites
-- in the SAME church, and a cycle is unrepresentable at write time.
--
-- WHY THIS EXISTS. The FRD's TaskDependency join is how a planter makes the
-- order of work visible rather than remembered. Blocked-ness is DERIVED from
-- these edges (any live prerequisite whose status is not `complete`), so this
-- table is the only new fact; nothing writes `tasks.status = 'blocked'` on
-- the planter's behalf.
--
-- CHURCH SCOPE IS THE ROW SHAPE, NOT A SERVICE CHECK. Both foreign keys are
-- composite onto `tasks(id, church_id)`, so an edge that names two churches
-- is unrepresentable. That pair needs `tasks_id_church_id_unique_idx` —
-- `id` is already unique, the pair exists so Postgres can spell the FK.
-- The write path still inserts via `insert … select` joining both task rows
-- on church_id: a forged id that names no live row in this church inserts
-- nothing. The CHECK refuses a self-loop; longer cycles are an application
-- rule (`wouldCreateCycle` in `src/lib/tasks/dependencies.ts`).
--
-- UNIQUE (task_id, prerequisite_task_id) is the duplicate-edge arbiter, and
-- the insert speaks for it with `ON CONFLICT DO NOTHING`.
--
-- CASCADE ON BOTH TASK FKs. A HARD delete of either end takes the edge with
-- it. The product soft-deletes, so this fires for wipe/repair the same way
-- `tasks.parent_task_id` does (0038). Soft-deleted prerequisites stop
-- blocking because the blocked-state query filters `deleted_at`.
--
-- ADDITIVE AND NON-REWRITING. One new table, three foreign keys, three
-- indexes (one of them on `tasks`, the composite-FK target) and one CHECK.
-- Nothing existing is altered, nothing is backfilled. `planWipe()` derives
-- delete order from `pg_constraint` — never write it down as a list
-- (memory/invariants.md → Dev Seeds).
--
-- ORDER MATTERS ONCE. `tasks_id_church_id_unique_idx` MUST exist before the
-- composite FKs that reference `(id, church_id)`. A database lacking it
-- refuses those ALTERs. The generated statement order put the index last;
-- this file puts it first.
--
-- DEPLOY MIGRATION FIRST. The write path inserts into this table, so a
-- code-first deploy is `relation "task_dependencies" does not exist` on
-- every save that names a prerequisite. Nothing in this repo applies
-- migrations on deploy (`package.json` has only `"build": "next build"`),
-- so an operator must run `pnpm db:migrate` BEFORE the deploy that carries
-- the code. The unique index on `tasks` is unused by the old build, so
-- migration-first is fine the other way too.
--
-- SIBLING RECONCILE. This migration's `when` (1786859124814) is above
-- 0042's (1786769854360), so a `db:migrate` run that sees both applies
-- 0042 then 0043 and neither is skipped. Nothing here owes a forward
-- reconcile. A migration from ANOTHER branch merging with a `when` above
-- 1786769854360 and at or below 1786859124814 owes it
-- (memory/invariants.md → Migrations).
--
-- ROLLBACK (HR2). The composite FKs drop with the table; the unique index
-- on `tasks` does not. Two statements, then the ledger delete, in ONE
-- psql session:
--
--   DROP TABLE IF EXISTS "task_dependencies";
--   DROP INDEX IF EXISTS "tasks_id_church_id_unique_idx";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786859124814;
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0040/0042: the journal is the
-- repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted.
-- Removing the journal entry instead makes drizzle-kit forget the migration
-- while the ledger still claims it applied, which is unrecoverable by
-- restoring the entry.
--
-- The row can also be identified by the sha256 of THIS FILE, byte for byte,
-- from the deployed commit:
--
--   shasum -a 256 src/db/migrations/0043_task_dependencies.sql
--
-- ROLLING BACK REQUIRES REVERTING THE CODE TOO. The task form and the list
-- blocked-state query read this table, so dropping it under a live build
-- breaks those paths. Revert the application half first, then drop.
CREATE UNIQUE INDEX "tasks_id_church_id_unique_idx" ON "tasks" USING btree ("id","church_id");
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"prerequisite_task_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_no_self_check" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."prerequisite_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_church_fk" FOREIGN KEY ("task_id","church_id") REFERENCES "public"."tasks"("id","church_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_prereq_church_fk" FOREIGN KEY ("prerequisite_task_id","church_id") REFERENCES "public"."tasks"("id","church_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_edge_unique_idx" ON "task_dependencies" USING btree ("task_id","prerequisite_task_id");
--> statement-breakpoint
CREATE INDEX "task_dependencies_church_id_idx" ON "task_dependencies" USING btree ("church_id");
--> statement-breakpoint
CREATE INDEX "task_dependencies_prerequisite_idx" ON "task_dependencies" USING btree ("prerequisite_task_id");
