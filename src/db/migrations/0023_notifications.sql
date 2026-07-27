-- F11 / N-CORE — notifications foundation (issue #130).
--
-- Purely additive: three new tables, no column, constraint or index on an
-- existing table is touched, and no data is backfilled or rewritten. That is
-- what makes the rollback exact rather than approximate.
--
-- ROLLBACK (verified as part of this migration's high-risk gate) — run in this
-- order, then delete the 0023 entry from src/db/migrations/meta/_journal.json:
--
--   DROP TABLE IF EXISTS "notification_deliveries";
--   DROP TABLE IF EXISTS "notification_preferences";
--   DROP TABLE IF EXISTS "notifications";
--
-- Deliveries first: it is the only table with an FK into "notifications", so
-- dropping in this order needs no CASCADE and cannot take anything else with
-- it. Indexes and FK constraints go with their tables. Prior state is byte-
-- identical because nothing outside these three tables was ever written.

CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider_message_id" varchar(255),
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" varchar(20) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"digest_cadence" varchar(16),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"category" varchar(20) NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"entity_type" varchar(32),
	"entity_id" uuid,
	"dedupe_key" varchar(255),
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_notification_channel_idx" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_id_idx" ON "notification_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_category_channel_idx" ON "notification_preferences" USING btree ("user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_unique_idx" ON "notifications" USING btree ("church_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_feed_idx" ON "notifications" USING btree ("church_id","recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("church_id","recipient_user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_dispatch_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("church_id","entity_type","entity_id");