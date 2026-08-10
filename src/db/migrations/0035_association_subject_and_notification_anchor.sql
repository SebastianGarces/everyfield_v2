-- #304 WS3 / OV-013 — the association SUBJECT and the notification ANCHOR
-- (ruling #351, 2026-08-09).
--
-- WHAT IT SETTLES. Two tables made a CHURCH the mandatory tenant of a row, and
-- the third invitation type in the product — a sending church joining a NETWORK
-- — names no church. So that association was audited nowhere and announced to
-- nobody: `association_events.church_id` was NOT NULL with a plant as its
-- subject, and `notifications.church_id` was NOT NULL as the boundary every read
-- filters on (N-010). #351 ruled for the shape `src/db/schema/association-event.ts`
-- had asked for in its own header — a subject discriminator with one FK per
-- subject kind — and for the same move on the notification side, as ONE anchored
-- table rather than a parallel org-notifications table.
--
-- EXPAND-ONLY, AND NO ROW IS REWRITTEN. Four new columns, two of them NOT NULL
-- WITH A DEFAULT (Postgres 11+ stores that in the catalog, so there is no table
-- rewrite and no long lock), two nullable. Two NOT NULL constraints are DROPPED,
-- which is a catalog change and cannot fail on data. Nothing is backfilled by a
-- statement: every pre-existing row is church-subject / church-anchored, which
-- is exactly what the two defaults give it. No existing column, index or
-- constraint is altered — in particular `notifications_dedupe_key_unique_idx` is
-- untouched, because `dbEnqueueDeps.insertIfAbsent` mirrors its predicate byte
-- for byte and every keyed enqueue in the product rides it.
--
-- ORDER MATTERS ONCE. The two `DROP NOT NULL`s run BEFORE the CHECKs are added;
-- the CHECKs are added AFTER the defaulted discriminators exist. Validating
-- `association_events_subject_check` scans the table, and it passes on legacy
-- rows precisely because `subject_type` has already defaulted to 'church' while
-- `church_id` is still populated on every one of them.
--
-- THE DEFAULTS STAY. `subject_type` and `anchor_type` keep their DEFAULT after
-- this migration, deliberately: a raw INSERT that names an org anchor and
-- forgets the discriminator then fails the CHECK (a loud error) rather than
-- being rejected for a null (a different, less legible one), and a raw INSERT
-- that names neither still files itself correctly as the church case.
--
-- ROLLBACK (HR2). Reversible in one psql session, and it loses only rows that
-- could not have existed before it — an org-anchored notification and a
-- sending-church-subject audit row are both new shapes. DELETE those first, or
-- the two `SET NOT NULL`s fail on them:
--
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_anchor_check";
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_anchor_type_check";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_check";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_type_check";
--   DROP INDEX IF EXISTS "notifications_org_feed_idx";
--   DROP INDEX IF EXISTS "notifications_org_dedupe_key_unique_idx";
--   DROP INDEX IF EXISTS "association_events_subject_sending_church_idx";
--   DELETE FROM "notifications" WHERE "anchor_org_id" IS NOT NULL;
--   DELETE FROM "association_events" WHERE "subject_sending_church_id" IS NOT NULL;
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "anchor_org_id";
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "anchor_type";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_sending_church_id_sending_churches_i";
--   ALTER TABLE "association_events" DROP COLUMN IF EXISTS "subject_sending_church_id";
--   ALTER TABLE "association_events" DROP COLUMN IF EXISTS "subject_type";
--   ALTER TABLE "notifications" ALTER COLUMN "church_id" SET NOT NULL;
--   ALTER TABLE "association_events" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "association_events" ADD COLUMN "subject_type" varchar(20) DEFAULT 'church' NOT NULL;--> statement-breakpoint
ALTER TABLE "association_events" ADD COLUMN "subject_sending_church_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "anchor_type" varchar(20) DEFAULT 'church' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "anchor_org_id" uuid;--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("subject_sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "association_events_subject_sending_church_idx" ON "association_events" USING btree ("subject_sending_church_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_dedupe_key_unique_idx" ON "notifications" USING btree ("anchor_org_id","recipient_user_id","dedupe_key") WHERE "notifications"."anchor_org_id" is not null and "notifications"."dedupe_key" is not null and "notifications"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "notifications_org_feed_idx" ON "notifications" USING btree ("anchor_org_id","recipient_user_id","created_at");--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_type_check" CHECK ("association_events"."subject_type" in ('church', 'sending_church'));--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_check" CHECK ((
        ("association_events"."subject_type" = 'church'
          and "association_events"."church_id" is not null
          and "association_events"."subject_sending_church_id" is null)
        or
        ("association_events"."subject_type" = 'sending_church'
          and "association_events"."subject_sending_church_id" is not null
          and "association_events"."church_id" is null)
      ));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_anchor_type_check" CHECK ("notifications"."anchor_type" in ('church', 'sending_church', 'network'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_anchor_check" CHECK ((
        ("notifications"."anchor_type" = 'church'
          and "notifications"."church_id" is not null
          and "notifications"."anchor_org_id" is null)
        or
        ("notifications"."anchor_type" in ('sending_church', 'network')
          and "notifications"."anchor_org_id" is not null
          and "notifications"."church_id" is null)
      ));
