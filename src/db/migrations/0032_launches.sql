-- LS-001/2/3/6 — Launch Sunday becomes an entity, and `churches.launch_date` is
-- DROPPED (issue #305 / WS1, carried from #285; FRD
-- `product-docs/features/launch/frd.md`).
--
-- *** THIS MIGRATION IS NOT EXPAND-ONLY, BY RULING. *** The last statement drops
-- a column that shipped code still names, so a build deployed BEFORE this
-- migration breaks the moment it runs. #285 ruled that explicitly: the schema,
-- every reader, and the reseed land and deploy as ONE unit, because mirroring
-- the date on both the church row and the launch row for a release is precisely
-- the two-owners state LS-001 exists to end. There are no users yet.
--
-- ORDER MATTERS. `launches` is created, the existing dates are copied into it,
-- and only then is the column dropped. The copy is not strictly needed on the
-- dev database (which is wiped and reseeded as part of this slice, ruled on
-- #271) — it is here so the migration is correct on any database that has real
-- rows, rather than correct only on the one it was written against.
--
-- WHAT THE BACKFILL DOES NOT DO:
--   * no `launch_events` row — the journal's `actor_user_id` is NOT NULL and a
--     backfill has no actor. "No journal entry before 0032" is the honest
--     record; inventing an actor to fill a column is not.
--   * no `launch_milestones` rows — the Playbook template lives in TypeScript
--     (`src/lib/launch/milestones.ts`), so seeding is the service layer's job
--     and a backfilled launch seeds on its next write. Duplicating the template
--     text into SQL is how the two drift.
--
-- WHY THE ENUMS ARE CHECKS. `.$type<>()` on a varchar is a compile-time brand and
-- nothing else — the finding migration 0024 acted on for the notification tables
-- and 0031 repeated for `association_events`. `status`, `area` and `event` are
-- closed sets, so they are closed in the data. `launches_target_date_check`
-- additionally makes "scheduled with no day" unrepresentable, so no countdown
-- reader has to defend against it.
--
-- ROLLBACK (HR2). The four tables are new and nothing outside them references
-- them, so undoing them is four DROPs. Restoring the column is a real restore:
-- it re-creates `churches.launch_date` and copies the dates back OUT of
-- `launches` before those rows are dropped. Run in ONE psql session, in this
-- order:
--
--   ALTER TABLE "churches" ADD COLUMN "launch_date" date;
--   UPDATE "churches" c SET "launch_date" = l."target_date"
--     FROM "launches" l WHERE l."church_id" = c."id" AND l."target_date" IS NOT NULL;
--   DROP TABLE IF EXISTS "launch_milestone_tasks";
--   DROP TABLE IF EXISTS "launch_milestones";
--   DROP TABLE IF EXISTS "launch_events";
--   DROP TABLE IF EXISTS "launches";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0032 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of what
-- ran, and only the ledger row is deleted. Removing the journal entry instead
-- makes drizzle-kit forget the migration while the ledger still claims it
-- applied, which is unrecoverable by restoring the entry.
--
-- `<0032 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0032_launches.sql
--
-- or identify the row by its `_journal.json` "when".
--
-- NOTE the rollback loses anything the launch entity holds that the column
-- never could: status, outcome, milestones, and the journal. That is the cost
-- of a not-expand-only migration and was accepted with the ruling.

CREATE TABLE "launch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"event" varchar(20) NOT NULL,
	"previous_target_date" date,
	"target_date" date,
	"previous_status" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"note" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "launch_events_event_check" CHECK ("launch_events"."event" in ('scheduled', 'moved', 'postponed', 'completed')),
	CONSTRAINT "launch_events_status_check" CHECK ("launch_events"."status" in ('planning', 'scheduled', 'completed', 'postponed')),
	CONSTRAINT "launch_events_previous_status_check" CHECK ("launch_events"."previous_status" in ('planning', 'scheduled', 'completed', 'postponed'))
);
--> statement-breakpoint
CREATE TABLE "launch_milestone_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"template_key" varchar(64) NOT NULL,
	"area" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"completed_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "launch_milestones_area_check" CHECK ("launch_milestones"."area" in ('operations', 'launch_team', 'promotion'))
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"target_date" date,
	"status" varchar(20) DEFAULT 'planning' NOT NULL,
	"outcome_recorded_at" timestamp,
	"attendance_count" integer,
	"decisions_count" integer,
	"outcome_notes" text,
	"capture_the_day" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "launches_status_check" CHECK ("launches"."status" in ('planning', 'scheduled', 'completed', 'postponed')),
	CONSTRAINT "launches_target_date_check" CHECK ("launches"."status" = 'planning' or "launches"."target_date" is not null),
	CONSTRAINT "launches_attendance_count_check" CHECK ("launches"."attendance_count" is null or "launches"."attendance_count" >= 0),
	CONSTRAINT "launches_decisions_count_check" CHECK ("launches"."decisions_count" is null or "launches"."decisions_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "launch_events" ADD CONSTRAINT "launch_events_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_events" ADD CONSTRAINT "launch_events_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_events" ADD CONSTRAINT "launch_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestone_tasks" ADD CONSTRAINT "launch_milestone_tasks_milestone_id_launch_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."launch_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestone_tasks" ADD CONSTRAINT "launch_milestone_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestone_tasks" ADD CONSTRAINT "launch_milestone_tasks_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestones" ADD CONSTRAINT "launch_milestones_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestones" ADD CONSTRAINT "launch_milestones_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_milestones" ADD CONSTRAINT "launch_milestones_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "launch_events_launch_id_created_at_idx" ON "launch_events" USING btree ("launch_id","created_at");--> statement-breakpoint
CREATE INDEX "launch_events_church_id_idx" ON "launch_events" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_milestone_tasks_unique" ON "launch_milestone_tasks" USING btree ("milestone_id","task_id");--> statement-breakpoint
CREATE INDEX "launch_milestone_tasks_task_id_idx" ON "launch_milestone_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_milestones_launch_id_template_key_unique" ON "launch_milestones" USING btree ("launch_id","template_key");--> statement-breakpoint
CREATE INDEX "launch_milestones_church_id_idx" ON "launch_milestones" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "launches_church_id_unique" ON "launches" USING btree ("church_id");--> statement-breakpoint
-- Backfill: every church that named a day gets a `scheduled` launch carrying it.
-- Runs AFTER `launches_church_id_unique` exists, so the one-live-launch-per-
-- church rule holds for the rows this migration itself writes.
INSERT INTO "launches" ("church_id", "target_date", "status")
SELECT "id", "launch_date", 'scheduled' FROM "churches" WHERE "launch_date" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "churches" DROP COLUMN "launch_date";